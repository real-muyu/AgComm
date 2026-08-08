// SPDX-License-Identifier: Elastic-2.0
import type { Socket } from "node:net";
import { AiRuntimeError, type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type { GatewayRunRecord, GatewayRunStream, GatewayStreamFrame } from "../gateway/RuntimeGateway.ts";
import type { GatewayIpcStreamResponse } from "./GatewayIpcProtocol.ts";

export class GatewayRunStreamConnection {
  private buffer = ""; private acknowledged = false; private consumed = false; private closed = false;
  private cursor: number; private readonly queue: GatewayStreamFrame[] = []; private wake?: () => void; private terminalError?: unknown;
  private resolveCompletion!: (record: GatewayRunRecord) => void; private rejectCompletion!: (error: unknown) => void;
  readonly completion = new Promise<GatewayRunRecord>((resolve, reject) => { this.resolveCompletion = resolve; this.rejectCompletion = reject; });
  constructor(private readonly socket: Socket, afterSequence: number | undefined, private readonly resolveStream: (stream: GatewayRunStream) => void, private readonly rejectStream: (error: unknown) => void) { this.cursor = Math.max(0, Math.floor(afterSequence ?? 0)); void this.completion.catch(() => {}); }
  private notify() { const current = this.wake; this.wake = undefined; current?.(); }
  fail(error: unknown) { if (this.closed) return; this.closed = true; this.terminalError = error instanceof AiRuntimeError || error instanceof DOMException ? error : new AiRuntimeError("GATEWAY_UNAVAILABLE", "Gateway stream connection failed", { cause: error }); this.rejectCompletion(this.terminalError); this.notify(); if (!this.acknowledged) this.rejectStream(this.terminalError); }
  closeUnexpectedly() { if (!this.closed) this.fail(new AiRuntimeError("GATEWAY_STREAM_CLOSED", "Gateway stream closed before completion")); }
  onData(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 5 * 1_048_576) return this.destroy(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Gateway stream frame exceeds the IPC limit"));
    for (;;) { const newline = this.buffer.indexOf("\n"); if (newline < 0) return; const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1); if (line) this.parse(line); }
  }
  private parse(line: string) { let response: GatewayIpcStreamResponse; try { response = JSON.parse(line) as GatewayIpcStreamResponse; } catch (error) { return this.destroy(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned an invalid stream response", { cause: error })); } this.accept(response); }
  private accept(response: GatewayIpcStreamResponse) {
    if ("ok" in response) return this.acknowledge(response);
    if ("stream" in response) { if (!this.acknowledged) return this.destroy(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Gateway sent a stream frame before acknowledgement")); this.queue.push(response.frame); this.notify(); return; }
    if (!this.acknowledged) return this.destroy(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Gateway completed a stream before acknowledgement"));
    this.closed = true; this.resolveCompletion(response.record); this.notify(); this.socket.end();
  }
  private acknowledge(response: Extract<GatewayIpcStreamResponse, { ok: boolean }>) {
    if (!response.ok) return this.destroy(new AiRuntimeError(response.error.code, response.error.message));
    if (this.acknowledged) return this.destroy(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned duplicate stream acknowledgement"));
    this.acknowledged = true; const value = response.value as { runId: string; mode: AiStreamMode }; this.resolveStream(this.createStream(value.runId, value.mode));
  }
  private createStream(runId: string, mode: AiStreamMode): GatewayRunStream {
    const self = this; return { runId, mode, get lastSequence() { return self.cursor; }, completion: this.completion, async *[Symbol.asyncIterator]() {
      if (self.consumed) throw new AiRuntimeError("GATEWAY_STREAM_ALREADY_CONSUMED", "Gateway run stream only supports one consumer"); self.consumed = true;
      try { for (;;) { while (self.queue.length) { const frame = self.queue.shift()!; self.cursor = Math.max(self.cursor, frame.sequence); yield frame; } if (self.closed) { if (self.terminalError) throw self.terminalError; return; } await new Promise<void>((resolve) => { self.wake = resolve; }); } }
      finally { if (!self.closed) self.destroy(new DOMException("Gateway stream consumer stopped", "AbortError")); }
    } };
  }
  private destroy(error: unknown) { this.fail(error); this.socket.destroy(); }
}
