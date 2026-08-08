// SPDX-License-Identifier: Elastic-2.0
import { AiRuntimeError, type AiStreamEvent, type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type { GatewayRunRecord, GatewayRunStream, GatewayStreamFrame } from "./GatewayState.ts";

export type GatewayWatchPort = {
  now(): Date;
  runRecord(id: string, runId: string): Promise<GatewayRunRecord>;
  waitForRun(id: string, runId: string): Promise<GatewayRunRecord>;
  readFrames(id: string, runId: string, after: number): Promise<GatewayStreamFrame[] | undefined>;
};

const finished = (record: GatewayRunRecord) => record.status === "completed" || record.status === "failed" || record.status === "cancelled";
function delay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => { const finish = () => { signal?.removeEventListener("abort", abort); resolve(); }; const timer = setTimeout(finish, ms); const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); }; signal?.addEventListener("abort", abort, { once: true }); });
}

function assertWatchable(record: GatewayRunRecord, mode: AiStreamMode, now: Date) {
  if (Date.parse(record.streamExpiresAt) <= now.getTime() && finished(record)) throw new AiRuntimeError("GATEWAY_STREAM_EXPIRED", `Gateway stream has expired: ${record.id}`);
  if (mode === "events" && record.streamMode !== "events") throw new AiRuntimeError("GATEWAY_STREAM_MODE_UNAVAILABLE", "A text-only Gateway run cannot be replayed as full events");
}

class GatewayRunWatcher {
  cursor: number;
  private consumed = false;
  constructor(private readonly port: GatewayWatchPort, private readonly appId: string, private readonly runId: string, private readonly initial: GatewayRunRecord, readonly mode: AiStreamMode, private readonly signal?: AbortSignal, after = 0) { this.cursor = Math.max(0, Math.floor(after)); }

  private projected(frames: readonly GatewayStreamFrame[]) {
    if (this.mode !== "text" || this.initial.streamMode !== "events") return frames;
    return frames.flatMap((frame) => {
      const event = frame.value as AiStreamEvent;
      return event?.type === "output-delta" ? [{ sequence: frame.sequence, value: event.text }] : [];
    });
  }

  private assertRetained(stored: GatewayStreamFrame[] | undefined, frames: readonly GatewayStreamFrame[], current: GatewayRunRecord) {
    if (!finished(current) || this.cursor >= current.lastSequence) return;
    if (!stored) throw new AiRuntimeError("GATEWAY_STREAM_EXPIRED", `Gateway stream is no longer retained: ${this.runId}`);
    if (!frames.length) throw new AiRuntimeError("GATEWAY_STREAM_INCOMPLETE", `Gateway stream log is incomplete: ${this.runId}`);
  }

  async *iterate() {
    if (this.consumed) throw new AiRuntimeError("GATEWAY_STREAM_ALREADY_CONSUMED", "Gateway run stream only supports one consumer");
    this.consumed = true;
    for (;;) {
      const stored = await this.port.readFrames(this.appId, this.runId, this.cursor);
      const frames = stored ?? [];
      for (const frame of frames) this.cursor = Math.max(this.cursor, frame.sequence);
      for (const frame of this.projected(frames)) yield frame;
      const current = await this.port.runRecord(this.appId, this.runId);
      this.assertRetained(stored, frames, current);
      if (finished(current) && this.cursor >= current.lastSequence) return;
      await delay(50, this.signal);
    }
  }
}

export async function watchGatewayRun(port: GatewayWatchPort, id: string, runId: string, options: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal } = {}): Promise<GatewayRunStream> {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  const initial = await port.runRecord(id, runId);
  const mode = options.mode ?? initial.streamMode;
  assertWatchable(initial, mode, port.now());
  const watcher = new GatewayRunWatcher(port, id, runId, initial, mode, options.signal, options.afterSequence);
  return { runId, mode, get lastSequence() { return watcher.cursor; }, completion: port.waitForRun(id, runId), [Symbol.asyncIterator]: () => watcher.iterate() };
}
