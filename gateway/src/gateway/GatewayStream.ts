// SPDX-License-Identifier: Elastic-2.0
import { appendFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { AiRuntimeError, type AiStreamEvent, type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import { MAX_STREAM_BYTES, MAX_STREAM_RUNS, STREAM_RETENTION_MS, type GatewayRunRecord, type GatewayRunStream, type GatewayState, type GatewayStreamFrame, type StreamState } from "./GatewayState.ts";
import { watchGatewayRun } from "./GatewayWatchService.ts";

/** In-memory run completion and stream ownership; persistence stays behind the facade during migration. */
export class GatewayStream {
  readonly states = new Map<string, StreamState>();
  readonly completions = new Map<string, { promise: Promise<GatewayRunRecord>; resolve(record: GatewayRunRecord): void }>();
  constructor(private readonly state?: GatewayState, private readonly now: () => Date = () => new Date()) {}
  private requireState() { if (!this.state) throw new AiRuntimeError("GATEWAY_NOT_INITIALIZED", "Gateway stream state is unavailable"); return this.state; }
  completion(runId: string) { const existing = this.completions.get(runId); if (existing) return existing; let resolve!: (record: GatewayRunRecord) => void; const promise = new Promise<GatewayRunRecord>((done) => { resolve = done; }); const created = { promise, resolve }; this.completions.set(runId, created); return created; }
  complete(record: GatewayRunRecord) { this.completions.get(record.id)?.resolve(structuredClone(record)); this.completions.delete(record.id); this.states.delete(record.id); }
  create(record: GatewayRunRecord, controller: AbortController): StreamState { const state = { appId: record.appId, runId: record.id, mode: record.streamMode, sequence: 0, bytes: 0, tail: Promise.resolve(), controller }; this.states.set(record.id, state); return state; }
  append(state: StreamState, value: string | AiStreamEvent) {
    const frame: GatewayStreamFrame = { sequence: state.sequence + 1, value }; const line = `${JSON.stringify(frame)}\n`; const bytes = Buffer.byteLength(line, "utf8");
    if (state.bytes + bytes > MAX_STREAM_BYTES) { const error = new AiRuntimeError("GATEWAY_STREAM_LIMIT_EXCEEDED", "Gateway stream log exceeds 4 MiB"); state.controller.abort(error); throw error; }
    state.sequence = frame.sequence; state.bytes += bytes; const store = this.requireState(); state.tail = state.tail.then(async () => { await mkdir(store.streamDirectory(state.appId), { recursive: true, mode: 0o700 }); await appendFile(store.streamPath(state.appId, state.runId), line, { encoding: "utf8", mode: 0o600 }); }).catch((error) => { const failure = error instanceof AiRuntimeError ? error : new AiRuntimeError("GATEWAY_WRITE_FAILED", "Unable to append Gateway stream log", { cause: error }); state.controller.abort(failure); throw failure; }); return frame;
  }
  async readFrames(id: string, runId: string, afterSequence: number) {
    const store = this.requireState(); let text = ""; try { text = await readFile(store.streamPath(id, runId), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new AiRuntimeError("GATEWAY_STATE_CORRUPT", `Unable to read stream log for ${runId}`, { cause: error }); }
    const lines = text.split("\n"); const frames: GatewayStreamFrame[] = []; for (let index = 0; index < lines.length; index++) { const line = lines[index]; if (!line) continue; try { const frame = JSON.parse(line) as GatewayStreamFrame; if (Number.isInteger(frame.sequence) && frame.sequence > afterSequence) frames.push(frame); } catch (error) { if (index === lines.length - 1) break; throw new AiRuntimeError("GATEWAY_STATE_CORRUPT", `Gateway stream log is invalid for ${runId}`, { cause: error }); } } return frames.sort((a, b) => a.sequence - b.sequence);
  }
  async cleanup(id: string, existingRuns?: GatewayRunRecord[]) {
    const store = this.requireState(); const runs = existingRuns ?? await store.listRuns(id); const cutoff = this.now().getTime() - STREAM_RETENTION_MS; const keep = new Set([...runs].filter((run) => Date.parse(run.startedAt) >= cutoff).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MAX_STREAM_RUNS).map((run) => `${run.id}.ndjson`)); let names: string[] = []; try { names = await readdir(store.streamDirectory(id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } await Promise.all(names.filter((name) => name.endsWith(".ndjson") && !keep.has(name)).map((name) => rm(join(store.streamDirectory(id), name), { force: true })));
  }
  watch(id: string, runId: string, options: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal } = {}): Promise<GatewayRunStream> { const store = this.requireState(); return watchGatewayRun({ now: this.now, runRecord: (appId, target) => store.runRecord(appId, target), waitForRun: async (appId, target) => { const record = await store.runRecord(appId, target); return ["completed", "failed", "cancelled"].includes(record.status) ? record : this.completion(target).promise; }, readFrames: (appId, target, after) => this.readFrames(appId, target, after) }, id, runId, options); }
}
