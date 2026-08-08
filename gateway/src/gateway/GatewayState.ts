// SPDX-License-Identifier: Elastic-2.0
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AiRuntimeError, type AiStreamEvent, type AiStreamMode, type AppBackgroundConfig, type ContactReceipt, type ContactRequest, type CronTriggerConfig, type HeartbeatTriggerConfig, type RuntimeOptions } from "@agcomm/ai-runtime/gateway-host";
import { enforceGatewayPrivateMode } from "./GatewayFilePermissions.ts";

export const STREAM_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const MAX_STREAM_RUNS = 100;
export const MAX_STREAM_BYTES = 4 * 1_048_576;

export type GatewayAppSummary = { id: string; name: string; version: string; packageHash: string; enabled: boolean; installedAt: string; updatedAt: string; background: AppBackgroundConfig; requiresWebhook: boolean; webhookUrl?: string; notificationAdapters: string[]; nextRuns: Record<string, string>; defaultStreamMode: AiStreamMode };
export type GatewayRunRecord = { id: string; appId: string; packageHash: string; triggerId: string; triggerType: "heartbeat" | "cron"; scheduledAt: string; startedAt: string; finishedAt?: string; status: "queued" | "running" | "completed" | "failed" | "cancelled"; outputSummary?: string; error?: string; elapsedMs?: number; streamMode: AiStreamMode; lastSequence: number; streamExpiresAt: string };
export type GatewayStartRunOptions = { mode?: AiStreamMode };
export type GatewayRunTicket = { runId: string; status: "queued" | "running"; coalesced: boolean };
export type GatewayStreamFrame = { sequence: number; value: string | AiStreamEvent };
export interface GatewayRunStream extends AsyncIterable<GatewayStreamFrame> { readonly runId: string; readonly mode: AiStreamMode; readonly lastSequence: number; readonly completion: Promise<GatewayRunRecord> }
export type GatewayInboxItem = { id: string; appId: string; packageHash: string; nodeId: string; triggerId: string; runId: string; title: string; body: string; severity: "info" | "warning" | "critical"; dedupeKey?: string; createdAt: string; updatedAt: string; readAt?: string; deliveryStatus: "none" | "queued" | "delivered" | "failed" };
export type GatewayDelivery = { id: string; notificationId: string; adapterId: string; attempts: number; nextAttemptAt: string; status: "queued" | "delivered" | "failed"; lastError?: string };
export interface GatewayCredentialStore { get(appId: string): Promise<string | undefined>; set(appId: string, secret: string): Promise<void>; delete(appId: string): Promise<void> }
export type NotificationAdapterContext = { app: GatewayAppSummary; signal: AbortSignal };
export interface NotificationAdapter { readonly id: string; deliver(notification: GatewayInboxItem, context: NotificationAdapterContext): Promise<void> }
export type RuntimeGatewayOptions = { root?: string; runtime?: RuntimeOptions; credentialStore?: GatewayCredentialStore; notificationAdapters?: readonly NotificationAdapter[]; fetcher?: typeof globalThis.fetch; now?: () => Date };
export type GatewayInstallOptions = { enabled?: boolean; webhook?: { url: string; secret?: string }; notificationAdapters?: readonly string[] };
export type GatewayRegistry = { version: 1; apps: GatewayAppSummary[] };
export type GatewayTrigger = HeartbeatTriggerConfig | CronTriggerConfig;
export type PendingRun = { runId: string; trigger: GatewayTrigger; scheduledAt: Date; mode: AiStreamMode };
export type TriggerSession = { messages: Array<{ role: "user" | "assistant"; content: string }>; packageHash: string };
export type TriggerSessions = Record<string, TriggerSession>;
export type RunCompletion = { promise: Promise<GatewayRunRecord>; resolve(record: GatewayRunRecord): void };
export type StreamState = { appId: string; runId: string; mode: AiStreamMode; sequence: number; bytes: number; tail: Promise<void>; controller: AbortController };

export function gatewayAppId(value: string) { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new AiRuntimeError("GATEWAY_APP_ID_INVALID", `Invalid Gateway app id: ${value}`); return value; }
export async function atomicWrite(path: string, value: string | Uint8Array) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temporary, value, { mode: 0o600 }); await rename(temporary, path); await enforceGatewayPrivateMode(path, 0o600); } catch (error) { await rm(temporary, { force: true }); throw new AiRuntimeError("GATEWAY_WRITE_FAILED", `Unable to write Gateway state: ${path}`, { cause: error }); } }
export async function readJson<T>(path: string, fallback: T): Promise<T> { try { return JSON.parse(await readFile(path, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw new AiRuntimeError("GATEWAY_STATE_CORRUPT", `Gateway state is invalid: ${path}`, { cause: error }); } }

/** Owns persisted registry paths and per-resource write serialization. */
export class GatewayState {
  registry: GatewayRegistry = { version: 1, apps: [] };
  private readonly locks = new Map<string, Promise<void>>();
  constructor(readonly root: string, readonly now: () => Date) {}
  private installHandler?: (input: string | Uint8Array | ArrayBuffer, options: GatewayInstallOptions) => Promise<GatewayAppSummary>;
  bindInstall(handler: (input: string | Uint8Array | ArrayBuffer, options: GatewayInstallOptions) => Promise<GatewayAppSummary>) { this.installHandler = handler; }
  install(input: string | Uint8Array | ArrayBuffer, options: GatewayInstallOptions = {}) { if (!this.installHandler) throw new AiRuntimeError("GATEWAY_NOT_INITIALIZED", "Gateway install service is unavailable"); return this.installHandler(input, options); }
  registryPath() { return join(this.root, "registry.json"); }
  appDirectory(id: string) { return join(this.root, "apps", gatewayAppId(id)); }
  statePath(id: string, name: string) { return join(this.root, "state", gatewayAppId(id), name); }
  streamDirectory(id: string) { return this.statePath(id, "streams"); }
  streamPath(id: string, runId: string) { return join(this.streamDirectory(id), `${runId}.ndjson`); }
  app(id: string) { const item = this.registry.apps.find((app) => app.id === id); if (!item) throw new AiRuntimeError("GATEWAY_APP_NOT_FOUND", `Gateway app was not found: ${id}`); return item; }
  async withLock<T>(key: string, action: () => Promise<T>) { const previous = this.locks.get(key) ?? Promise.resolve(); let release!: () => void; const current = new Promise<void>((resolveLock) => { release = resolveLock; }); const queued = previous.then(() => current); this.locks.set(key, queued); await previous; try { return await action(); } finally { release(); if (this.locks.get(key) === queued) this.locks.delete(key); } }
  async saveRegistry() { await atomicWrite(this.registryPath(), `${JSON.stringify(this.registry, null, 2)}\n`); }
  async initialize() {
    await mkdir(join(this.root, "apps"), { recursive: true, mode: 0o700 });
    await mkdir(join(this.root, "state"), { recursive: true, mode: 0o700 });
    this.registry = await readJson<GatewayRegistry>(this.registryPath(), { version: 1, apps: [] });
    if (this.registry.version !== 1 || !Array.isArray(this.registry.apps)) throw new AiRuntimeError("GATEWAY_STATE_CORRUPT", "Unsupported Gateway registry version");
  }
  async listApps() { return structuredClone(this.registry.apps).sort((a, b) => a.name.localeCompare(b.name)); }
  async listRuns(id: string) {
    this.app(id);
    const runs = await readJson<GatewayRunRecord[]>(this.statePath(id, "runs.json"), []);
    return runs.map((run) => ({ ...run, streamMode: run.streamMode ?? "text", lastSequence: run.lastSequence ?? 0, streamExpiresAt: run.streamExpiresAt ?? new Date(Date.parse(run.startedAt) + STREAM_RETENTION_MS).toISOString() }));
  }
  async writeRuns(id: string, runs: GatewayRunRecord[]) { await atomicWrite(this.statePath(id, "runs.json"), `${JSON.stringify(runs.slice(-1_000), null, 2)}\n`); }
  async upsertRun(id: string, record: GatewayRunRecord) {
    await this.withLock(`${id}:runs`, async () => { const runs = await readJson<GatewayRunRecord[]>(this.statePath(id, "runs.json"), []); const index = runs.findIndex((run) => run.id === record.id); if (index >= 0) runs[index] = structuredClone(record); else runs.push(structuredClone(record)); await this.writeRuns(id, runs); });
  }
  async runRecord(id: string, runId: string) { const record = (await this.listRuns(id)).find((run) => run.id === runId); if (!record) throw new AiRuntimeError("GATEWAY_RUN_NOT_FOUND", `Gateway run was not found: ${runId}`); return record; }
  async triggerSessions(id: string) { return readJson<TriggerSessions>(this.statePath(id, "sessions.json"), {}); }
  async saveTriggerSessions(id: string, sessions: TriggerSessions) { await atomicWrite(this.statePath(id, "sessions.json"), `${JSON.stringify(sessions, null, 2)}\n`); }
}

export type GatewayContactHandler = (app: GatewayAppSummary, request: ContactRequest) => Promise<ContactReceipt>;
