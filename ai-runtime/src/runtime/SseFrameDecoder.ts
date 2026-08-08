import { Buffer } from "node:buffer";
import { AiRuntimeError } from "../errors.ts";

/** Stateful UTF-8 SSE line decoder, isolated from network transport. */
export class SseFrameDecoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private dataLines: string[] = [];
  stopped = false;
  constructor(private readonly doneData: string, private readonly maxEventBytes: number) {}
  push(bytes: Uint8Array) { return this.consume(this.decode(bytes, true)); }
  finish() {
    const frames = this.consume(this.decode());
    if (this.pending) { const data = this.line(this.pending.replace(/\r$/, "")); this.pending = ""; if (data !== undefined) frames.push(data); }
    const data = this.frame(); if (data !== undefined) frames.push(data);
    return frames;
  }
  private decode(bytes?: Uint8Array, stream = false) {
    try { return bytes ? this.decoder.decode(bytes, { stream }) : this.decoder.decode(); }
    catch (error) { throw new AiRuntimeError("HTTP_SSE_INVALID", "Provider SSE response is not UTF-8", { cause: error }); }
  }
  private consume(chunk: string) {
    this.pending += chunk; const frames: string[] = [];
    for (;;) { const newline = this.pending.indexOf("\n"); if (newline < 0 || this.stopped) break; const data = this.line(this.pending.slice(0, newline).replace(/\r$/, "")); this.pending = this.pending.slice(newline + 1); if (data !== undefined) frames.push(data); }
    return frames;
  }
  private line(value: string) {
    if (value === "") return this.frame();
    if (value.startsWith(":")) return undefined;
    const colon = value.indexOf(":"); const field = colon < 0 ? value : value.slice(0, colon); let content = colon < 0 ? "" : value.slice(colon + 1);
    if (content.startsWith(" ")) content = content.slice(1); if (field === "data") this.dataLines.push(content); return undefined;
  }
  private frame() {
    if (!this.dataLines.length) return undefined;
    const data = this.dataLines.join("\n"); this.dataLines = [];
    if (Buffer.byteLength(data) > this.maxEventBytes) throw new AiRuntimeError("HTTP_SSE_INVALID", "Provider SSE event exceeds 256 KiB");
    if (data === this.doneData) { this.stopped = true; return undefined; }
    return data;
  }
}
