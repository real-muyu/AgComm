// SPDX-License-Identifier: Elastic-2.0
import { createHash, createHmac, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  AiRuntimeError,
  createSafeOutboundFetch,
  executeGatewayTrigger,
  inspectGatewayPackage,
  validateResolvedPublicUrl,
  type AiStreamEvent,
  type AiStreamMode,
  type AppBackgroundConfig,
  type BackgroundTriggerContext,
  type ContactReceipt,
  type ContactRequest,
  type CronTriggerConfig,
  type HeartbeatTriggerConfig,
  type RuntimeOptions,
} from "@agcomm/ai-runtime/gateway-host";
import { nextCronOccurrence } from "./background-schedule.ts";

const RETRY_DELAYS = [60_000, 300_000, 1_800_000, 7_200_000] as const;
const MAX_INBOX = 10_000;
const INBOX_RETENTION_MS = 90 * 24 * 60 * 60_000;
const STREAM_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_STREAM_RUNS = 100;
const MAX_STREAM_BYTES = 4 * 1_048_576;

export type GatewayAppSummary = {
  id: string;
  name: string;
  version: string;
  packageHash: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  background: AppBackgroundConfig;
  requiresWebhook: boolean;
  webhookUrl?: string;
  notificationAdapters: string[];
  nextRuns: Record<string, string>;
  defaultStreamMode: AiStreamMode;
};

export type GatewayRunRecord = {
  id: string;
  appId: string;
  packageHash: string;
  triggerId: string;
  triggerType: "heartbeat" | "cron";
  scheduledAt: string;
  startedAt: string;
  finishedAt?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  outputSummary?: string;
  error?: string;
  elapsedMs?: number;
  streamMode: AiStreamMode;
  lastSequence: number;
  streamExpiresAt: string;
};

export type GatewayStartRunOptions = { mode?: AiStreamMode };
export type GatewayRunTicket = { runId: string; status: "queued" | "running"; coalesced: boolean };
export type GatewayStreamFrame = { sequence: number; value: string | AiStreamEvent };
export interface GatewayRunStream extends AsyncIterable<GatewayStreamFrame> {
  readonly runId: string;
  readonly mode: AiStreamMode;
  readonly lastSequence: number;
  readonly completion: Promise<GatewayRunRecord>;
}

export type GatewayInboxItem = {
  id: string;
  appId: string;
  packageHash: string;
  nodeId: string;
  triggerId: string;
  runId: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  dedupeKey?: string;
  createdAt: string;
  updatedAt: string;
  readAt?: string;
  deliveryStatus: "none" | "queued" | "delivered" | "failed";
};

export type GatewayDelivery = {
  id: string;
  notificationId: string;
  adapterId: string;
  attempts: number;
  nextAttemptAt: string;
  status: "queued" | "delivered" | "failed";
  lastError?: string;
};

export interface GatewayCredentialStore {
  get(appId: string): Promise<string | undefined>;
  set(appId: string, secret: string): Promise<void>;
  delete(appId: string): Promise<void>;
}

export type NotificationAdapterContext = { app: GatewayAppSummary; signal: AbortSignal };
export interface NotificationAdapter {
  readonly id: string;
  deliver(notification: GatewayInboxItem, context: NotificationAdapterContext): Promise<void>;
}

export type RuntimeGatewayOptions = {
  root?: string;
  runtime?: RuntimeOptions;
  credentialStore?: GatewayCredentialStore;
  notificationAdapters?: readonly NotificationAdapter[];
  fetcher?: typeof globalThis.fetch;
  now?: () => Date;
};

export type GatewayInstallOptions = {
  enabled?: boolean;
  webhook?: { url: string; secret?: string };
  notificationAdapters?: readonly string[];
};

type GatewayRegistry = { version: 1; apps: GatewayAppSummary[] };
type TriggerSession = { messages: Array<{ role: "user" | "assistant"; content: string }>; packageHash: string };
type TriggerSessions = Record<string, TriggerSession>;
type GatewayTrigger = HeartbeatTriggerConfig | CronTriggerConfig;
type PendingRun = { runId: string; trigger: GatewayTrigger; scheduledAt: Date; mode: AiStreamMode };
type RunCompletion = { promise: Promise<GatewayRunRecord>; resolve(record: GatewayRunRecord): void };
type StreamState = { appId: string; runId: string; mode: AiStreamMode; sequence: number; bytes: number; tail: Promise<void>; controller: AbortController };

function defaultRoot() { return join(homedir(), ".agcomm", "runtime", "gateway"); }
function hashBytes(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function appId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new AiRuntimeError("GATEWAY_APP_ID_INVALID", `Invalid Gateway app id: ${value}`);
  return value;
}
function summary(value: unknown, limit = 4_096) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.slice(0, limit);
}
function errorText(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 4_096); }
async function atomicWrite(path: string, value: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, value, { mode: 0o600 }); await rename(temporary, path); try { await chmod(path, 0o600); } catch { /* Platform may ignore modes. */ } }
  catch (error) { await rm(temporary, { force: true }); throw new AiRuntimeError("GATEWAY_WRITE_FAILED", `Unable to write Gateway state: ${path}`, { cause: error }); }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw new AiRuntimeError("GATEWAY_STATE_CORRUPT", `Gateway state is invalid: ${path}`, { cause: error }); }
}

function wait(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolveWait, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolveWait();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createGatewayCredentialStore(): GatewayCredentialStore {
  const entry = async (id: string) => {
    try { const { AsyncEntry } = await import("@napi-rs/keyring"); return new AsyncEntry("io.agcomm.runtime.gateway.webhook", appId(id)); }
    catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Gateway webhook credential storage is unavailable", { cause: error }); }
  };
  return {
    async get(id) { try { return await (await entry(id)).getPassword(); } catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to read Gateway webhook secret", { cause: error }); } },
    async set(id, secret) { try { await (await entry(id)).setPassword(secret); } catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to save Gateway webhook secret", { cause: error }); } },
    async delete(id) { try { await (await entry(id)).deleteCredential(); } catch { /* Missing credentials are already deleted. */ } },
  };
}

export class RuntimeGateway {
  readonly root: string;
  private registry: GatewayRegistry = { version: 1, apps: [] };
  private readonly credentials: GatewayCredentialStore;
  private readonly adapters = new Map<string, NotificationAdapter>();
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;
  private ipc?: { close(): Promise<void> };
  private ticking = false;
  private lockOwner?: string;
  private readonly stateLocks = new Map<string, Promise<void>>();
  private readonly active = new Map<string, AbortController>();
  private readonly activeRunIds = new Map<string, string>();
  private readonly pending = new Map<string, Map<string, PendingRun>>();
  private readonly completions = new Map<string, RunCompletion>();
  private readonly streams = new Map<string, StreamState>();

  constructor(private readonly options: RuntimeGatewayOptions = {}) {
    this.root = resolve(options.root ?? defaultRoot());
    this.credentials = options.credentialStore ?? createGatewayCredentialStore();
    this.now = options.now ?? (() => new Date());
    for (const adapter of options.notificationAdapters ?? []) {
      if (!adapter.id || this.adapters.has(adapter.id) || adapter.id === "webhook") throw new AiRuntimeError("NOTIFICATION_ADAPTER_INVALID", `Invalid or duplicate notification adapter: ${adapter.id}`);
      this.adapters.set(adapter.id, adapter);
    }
  }

  private registryPath() { return join(this.root, "registry.json"); }
  private appDirectory(id: string) { return join(this.root, "apps", appId(id)); }
  private statePath(id: string, name: string) { return join(this.root, "state", appId(id), name); }
  private streamDirectory(id: string) { return this.statePath(id, "streams"); }
  private streamPath(id: string, runId: string) { return join(this.streamDirectory(id), `${runId}.ndjson`); }

  private async withStateLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.stateLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => { release = resolveLock; });
    const queued = previous.then(() => current);
    this.stateLocks.set(key, queued);
    await previous;
    try { return await action(); }
    finally { release(); if (this.stateLocks.get(key) === queued) this.stateLocks.delete(key); }
  }

  private async acquireInstanceLock() {
    const path = join(this.root, "gateway.lock");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const owner = `${process.pid}:${randomUUID()}`;
    const value = `${JSON.stringify({ version: 1, owner, pid: process.pid, startedAt: this.now().toISOString() })}\n`;
    const attempt = async () => {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(value); }
      finally { await handle.close(); }
    };
    try { await attempt(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new AiRuntimeError("GATEWAY_LOCK_FAILED", "Unable to acquire Runtime Gateway process lock", { cause: error });
      const lock = await readJson<{ startedAt?: string }>(path, {});
      const liveness = await readJson<{ at?: string }>(join(this.root, "liveness.json"), {});
      const latest = Math.max(Date.parse(lock.startedAt ?? ""), Date.parse(liveness.at ?? ""));
      if (Number.isFinite(latest) && this.now().getTime() - latest < 90_000) throw new AiRuntimeError("GATEWAY_ALREADY_RUNNING", "Another Runtime Gateway instance is active");
      await rm(path, { force: true });
      try { await attempt(); }
      catch (retryError) { throw new AiRuntimeError("GATEWAY_ALREADY_RUNNING", "Another Runtime Gateway instance acquired the process lock", { cause: retryError }); }
    }
    this.lockOwner = owner;
  }

  private async releaseInstanceLock() {
    if (!this.lockOwner) return;
    const path = join(this.root, "gateway.lock");
    try {
      const value = await readJson<{ owner?: string }>(path, {});
      if (value.owner === this.lockOwner) await rm(path, { force: true });
    } finally { this.lockOwner = undefined; }
  }

  async initialize() {
    await mkdir(join(this.root, "apps"), { recursive: true, mode: 0o700 });
    await mkdir(join(this.root, "state"), { recursive: true, mode: 0o700 });
    this.registry = await readJson<GatewayRegistry>(this.registryPath(), { version: 1, apps: [] });
    if (this.registry.version !== 1 || !Array.isArray(this.registry.apps)) throw new AiRuntimeError("GATEWAY_STATE_CORRUPT", "Unsupported Gateway registry version");
    const now = this.now();
    for (const app of this.registry.apps) {
      app.defaultStreamMode ??= "text";
      if (app.enabled && app.background.heartbeat) app.nextRuns[app.background.heartbeat.id] = new Date(now.getTime() + app.background.heartbeat.everyMs).toISOString();
      const runs = await this.listRuns(app.id);
      let changed = false;
      for (const run of runs) if (run.status === "queued" || run.status === "running") {
        run.status = "cancelled";
        run.finishedAt = now.toISOString();
        run.elapsedMs = Math.max(0, now.getTime() - Date.parse(run.startedAt));
        run.error = "Gateway restarted before the run completed";
        changed = true;
      }
      if (changed) await this.writeRuns(app.id, runs);
      await this.cleanupStreams(app.id, runs);
    }
    await this.saveRegistry();
    return this;
  }

  async status() {
    const liveness = await readJson<{ pid?: number; at?: string }>(join(this.root, "liveness.json"), {});
    const heartbeatAt = typeof liveness.at === "string" ? liveness.at : undefined;
    const healthy = Boolean(heartbeatAt && this.now().getTime() - Date.parse(heartbeatAt) <= 90_000);
    return { alive: true as const, pid: liveness.pid ?? process.pid, heartbeatAt, healthy };
  }

  private async saveRegistry() { await atomicWrite(this.registryPath(), `${JSON.stringify(this.registry, null, 2)}\n`); }
  private async writeRuns(id: string, runs: GatewayRunRecord[]) {
    await atomicWrite(this.statePath(id, "runs.json"), `${JSON.stringify(runs.slice(-1_000), null, 2)}\n`);
  }
  private async upsertRun(id: string, record: GatewayRunRecord) {
    await this.withStateLock(`${id}:runs`, async () => {
      const runs = await readJson<GatewayRunRecord[]>(this.statePath(id, "runs.json"), []);
      const index = runs.findIndex((run) => run.id === record.id);
      if (index >= 0) runs[index] = structuredClone(record);
      else runs.push(structuredClone(record));
      await this.writeRuns(id, runs);
    });
  }
  private completion(runId: string) {
    const existing = this.completions.get(runId);
    if (existing) return existing;
    let resolveCompletion!: (record: GatewayRunRecord) => void;
    const promise = new Promise<GatewayRunRecord>((resolveRun) => { resolveCompletion = resolveRun; });
    const created = { promise, resolve: resolveCompletion };
    this.completions.set(runId, created);
    return created;
  }
  private async runRecord(id: string, runId: string) {
    const record = (await this.listRuns(id)).find((run) => run.id === runId);
    if (!record) throw new AiRuntimeError("GATEWAY_RUN_NOT_FOUND", `Gateway run was not found: ${runId}`);
    return record;
  }
  private async waitForRun(id: string, runId: string) {
    const record = await this.runRecord(id, runId);
    if (record.status === "completed" || record.status === "failed" || record.status === "cancelled") return record;
    return this.completion(runId).promise;
  }
  private createStreamState(app: GatewayAppSummary, record: GatewayRunRecord, controller: AbortController): StreamState {
    const state = { appId: app.id, runId: record.id, mode: record.streamMode, sequence: 0, bytes: 0, tail: Promise.resolve(), controller };
    this.streams.set(record.id, state);
    return state;
  }
  private appendStream(state: StreamState, value: string | AiStreamEvent) {
    const frame: GatewayStreamFrame = { sequence: state.sequence + 1, value };
    const line = `${JSON.stringify(frame)}\n`;
    const bytes = Buffer.byteLength(line, "utf8");
    if (state.bytes + bytes > MAX_STREAM_BYTES) {
      const error = new AiRuntimeError("GATEWAY_STREAM_LIMIT_EXCEEDED", "Gateway stream log exceeds 4 MiB");
      state.controller.abort(error);
      throw error;
    }
    state.sequence = frame.sequence;
    state.bytes += bytes;
    state.tail = state.tail.then(async () => {
      await mkdir(this.streamDirectory(state.appId), { recursive: true, mode: 0o700 });
      await appendFile(this.streamPath(state.appId, state.runId), line, { encoding: "utf8", mode: 0o600 });
    }).catch((error) => {
      const failure = error instanceof AiRuntimeError ? error : new AiRuntimeError("GATEWAY_WRITE_FAILED", "Unable to append Gateway stream log", { cause: error });
      state.controller.abort(failure);
      throw failure;
    });
    return frame;
  }
  private async readStreamFrames(id: string, runId: string, afterSequence: number) {
    let text = "";
    try { text = await readFile(this.streamPath(id, runId), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new AiRuntimeError("GATEWAY_STATE_CORRUPT", `Unable to read stream log for ${runId}`, { cause: error });
    }
    const lines = text.split("\n");
    const frames: GatewayStreamFrame[] = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line) continue;
      try {
        const frame = JSON.parse(line) as GatewayStreamFrame;
        if (Number.isInteger(frame.sequence) && frame.sequence > afterSequence) frames.push(frame);
      } catch (error) {
        if (index === lines.length - 1) break;
        throw new AiRuntimeError("GATEWAY_STATE_CORRUPT", `Gateway stream log is invalid for ${runId}`, { cause: error });
      }
    }
    return frames.sort((left, right) => left.sequence - right.sequence);
  }
  private async cleanupStreams(id: string, existingRuns?: GatewayRunRecord[]) {
    const runs = existingRuns ?? await this.listRuns(id);
    const cutoff = this.now().getTime() - STREAM_RETENTION_MS;
    const retained = [...runs]
      .filter((run) => Date.parse(run.startedAt) >= cutoff)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, MAX_STREAM_RUNS);
    const keep = new Set(retained.map((run) => `${run.id}.ndjson`));
    let names: string[] = [];
    try { names = await readdir(this.streamDirectory(id)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await Promise.all(names.filter((name) => name.endsWith(".ndjson") && !keep.has(name)).map((name) => rm(join(this.streamDirectory(id), name), { force: true })));
  }
  private app(id: string) {
    const item = this.registry.apps.find((app) => app.id === id);
    if (!item) throw new AiRuntimeError("GATEWAY_APP_NOT_FOUND", `Gateway app was not found: ${id}`);
    return item;
  }

  private triggers(background: AppBackgroundConfig) {
    return [...(background.heartbeat ? [background.heartbeat] : []), ...(background.cron ?? [])];
  }

  private nextRun(trigger: GatewayTrigger, after: Date) {
    return "everyMs" in trigger ? new Date(after.getTime() + trigger.everyMs) : nextCronOccurrence(trigger.expression, trigger.timezone, after);
  }

  async install(pathOrBytes: string | Uint8Array | ArrayBuffer, install: GatewayInstallOptions = {}) {
    const bytes = typeof pathOrBytes === "string" ? new Uint8Array(await readFile(pathOrBytes)) : pathOrBytes instanceof Uint8Array ? new Uint8Array(pathOrBytes) : new Uint8Array(pathOrBytes);
    const inspected = await inspectGatewayPackage(bytes, this.options.runtime);
    const id = appId(inspected.appId);
    const requiresWebhook = inspected.requiresWebhook;
    const existing = this.registry.apps.find((app) => app.id === id);
    const webhookUrl = install.webhook?.url ?? existing?.webhookUrl;
    if (requiresWebhook && !webhookUrl) throw new AiRuntimeError("GATEWAY_WEBHOOK_REQUIRED", `App ${id} requires a Webhook URL`);
    if (webhookUrl) {
      const url = new URL(webhookUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new AiRuntimeError("GATEWAY_WEBHOOK_INVALID", "Webhook URL must be credential-free HTTPS without a query or fragment");
      try { await validateResolvedPublicUrl(url, { signal: new AbortController().signal }); }
      catch (error) { throw new AiRuntimeError("GATEWAY_WEBHOOK_INVALID", "Webhook URL must resolve to a public HTTPS endpoint", { cause: error }); }
    }
    if (install.webhook?.secret !== undefined) {
      if (install.webhook.secret.length < 16 || install.webhook.secret.length > 512) throw new AiRuntimeError("GATEWAY_WEBHOOK_SECRET_INVALID", "Webhook signing secret must contain 16–512 characters");
      await this.credentials.set(id, install.webhook.secret);
    } else if (requiresWebhook && !(await this.credentials.get(id))) {
      throw new AiRuntimeError("GATEWAY_WEBHOOK_REQUIRED", `App ${id} requires a Webhook signing secret`);
    }
    const configuredAdapters = [...new Set(install.notificationAdapters ?? existing?.notificationAdapters ?? [])];
    for (const adapter of configuredAdapters) if (!this.adapters.has(adapter)) throw new AiRuntimeError("NOTIFICATION_ADAPTER_NOT_FOUND", `Notification adapter is not registered: ${adapter}`);
    const now = this.now();
    const packageHash = hashBytes(bytes);
    if (packageHash !== inspected.packageHash) throw new AiRuntimeError("GATEWAY_PACKAGE_INVALID", "Runtime package hash does not match the installed bytes");
    if (existing && existing.packageHash !== packageHash) {
      await this.stopActive(id, "Gateway app package was replaced");
      await this.cancelPending(id, "Gateway app package was replaced");
    }
    await mkdir(this.appDirectory(id), { recursive: true, mode: 0o700 });
    await atomicWrite(join(this.appDirectory(id), "app.ai"), bytes);
    const nextRuns: Record<string, string> = {};
    for (const trigger of this.triggers(inspected.background)) {
      nextRuns[trigger.id] = ("everyMs" in trigger && trigger.runOnStart ? now : this.nextRun(trigger, now)).toISOString();
    }
    const record: GatewayAppSummary = {
      id, name: inspected.name, version: inspected.version, packageHash,
      enabled: install.enabled !== false,
      installedAt: existing?.installedAt ?? now.toISOString(), updatedAt: now.toISOString(),
      background: structuredClone(inspected.background), requiresWebhook,
      ...(webhookUrl ? { webhookUrl } : {}), notificationAdapters: configuredAdapters, nextRuns,
      defaultStreamMode: inspected.defaultStreamMode,
    };
    this.registry.apps = [...this.registry.apps.filter((app) => app.id !== id), record];
    if (existing?.packageHash !== packageHash) await atomicWrite(this.statePath(id, "sessions.json"), "{}\n");
    await this.saveRegistry();
    return structuredClone(record);
  }

  async enable(id: string) { const app = this.app(id); app.enabled = true; app.updatedAt = this.now().toISOString(); for (const trigger of this.triggers(app.background)) app.nextRuns[trigger.id] = this.nextRun(trigger, this.now()).toISOString(); await this.saveRegistry(); }
  async disable(id: string) {
    const app = this.app(id);
    app.enabled = false;
    app.updatedAt = this.now().toISOString();
    await this.stopActive(id, "Gateway app disabled");
    await this.cancelPending(id, "Gateway app is disabled");
    await this.saveRegistry();
  }
  async uninstall(id: string) {
    this.app(id);
    await this.stopActive(id, "Gateway app uninstalled");
    await this.cancelPending(id, "Gateway app was uninstalled");
    this.registry.apps = this.registry.apps.filter((app) => app.id !== id);
    await this.saveRegistry();
    await this.credentials.delete(id);
    await rm(this.appDirectory(id), { recursive: true, force: true });
  }
  async listApps() { return structuredClone(this.registry.apps).sort((a, b) => a.name.localeCompare(b.name)); }
  async listRuns(id: string) {
    this.app(id);
    const runs = await readJson<GatewayRunRecord[]>(this.statePath(id, "runs.json"), []);
    return runs.map((run) => ({
      ...run,
      streamMode: run.streamMode ?? "text",
      lastSequence: run.lastSequence ?? 0,
      streamExpiresAt: run.streamExpiresAt
        ?? new Date(Date.parse(run.startedAt) + STREAM_RETENTION_MS).toISOString(),
    }));
  }
  async listInbox(id: string) { this.app(id); return readJson<GatewayInboxItem[]>(this.statePath(id, "inbox.json"), []); }
  async markInboxRead(id: string, notificationIds: readonly string[]) { this.app(id); await this.withStateLock(`${id}:notifications`, async () => { const set = new Set(notificationIds); const inbox = await readJson<GatewayInboxItem[]>(this.statePath(id, "inbox.json"), []); const at = this.now().toISOString(); for (const item of inbox) if (set.has(item.id)) item.readAt = at; await atomicWrite(this.statePath(id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}\n`); }); }
  async retryDelivery(id: string, notificationId: string) { this.app(id); await this.withStateLock(`${id}:notifications`, async () => { const deliveries = await readJson<GatewayDelivery[]>(this.statePath(id, "deliveries.json"), []); let found = false; for (const delivery of deliveries) if (delivery.notificationId === notificationId && delivery.status === "failed") { delivery.status = "queued"; delivery.attempts = 0; delivery.nextAttemptAt = this.now().toISOString(); delete delivery.lastError; found = true; } if (!found) throw new AiRuntimeError("GATEWAY_DELIVERY_NOT_FOUND", `Failed delivery was not found: ${notificationId}`); await atomicWrite(this.statePath(id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}\n`); }); }

  private async recordContact(app: GatewayAppSummary, request: ContactRequest): Promise<ContactReceipt> {
    return this.withStateLock(`${app.id}:notifications`, async () => {
    const now = this.now();
    let inbox = await readJson<GatewayInboxItem[]>(this.statePath(app.id, "inbox.json"), []);
    inbox = inbox.filter((item) => now.getTime() - new Date(item.updatedAt).getTime() <= INBOX_RETENTION_MS);
    const duplicate = request.dedupeKey ? inbox.find((item) => item.dedupeKey === request.dedupeKey && now.getTime() - new Date(item.updatedAt).getTime() < 24 * 60 * 60_000) : undefined;
    if (duplicate) return { id: duplicate.id, status: "queued", webhookQueued: duplicate.deliveryStatus === "queued", createdAt: duplicate.createdAt };
    const adapters = [...app.notificationAdapters, ...(request.webhook ? ["webhook"] : [])];
    const item: GatewayInboxItem = {
      id: randomUUID(), appId: app.id, packageHash: app.packageHash, nodeId: request.nodeId, triggerId: request.trigger.id, runId: request.trigger.runId,
      title: request.title, body: request.body, severity: request.severity, ...(request.dedupeKey ? { dedupeKey: request.dedupeKey } : {}),
      createdAt: now.toISOString(), updatedAt: now.toISOString(), deliveryStatus: adapters.length ? "queued" : "none",
    };
    inbox.push(item);
    if (inbox.length > MAX_INBOX) inbox = inbox.slice(-MAX_INBOX);
    await atomicWrite(this.statePath(app.id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}\n`);
    if (adapters.length) {
      const deliveries = await readJson<GatewayDelivery[]>(this.statePath(app.id, "deliveries.json"), []);
      for (const adapterId of new Set(adapters)) deliveries.push({ id: randomUUID(), notificationId: item.id, adapterId, attempts: 0, nextAttemptAt: now.toISOString(), status: "queued" });
      await atomicWrite(this.statePath(app.id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}\n`);
    }
    return { id: item.id, status: "queued", webhookQueued: request.webhook, createdAt: item.createdAt };
    });
  }

  private previousRun(runs: GatewayRunRecord[], triggerId: string): BackgroundTriggerContext["previous"] {
    const previous = [...runs].reverse().find((run) => run.triggerId === triggerId
      && (run.status === "completed" || run.status === "failed") && run.finishedAt);
    return previous ? {
      status: previous.status as "completed" | "failed",
      finishedAt: previous.finishedAt!,
      ...(previous.outputSummary ? { outputSummary: previous.outputSummary } : {}),
    } : undefined;
  }

  private baseRunRecord(
    app: GatewayAppSummary,
    trigger: GatewayTrigger,
    scheduledAt: Date,
    runId: string,
    mode: AiStreamMode,
    status: "queued" | "running",
  ): GatewayRunRecord {
    const now = this.now();
    return {
      id: runId,
      appId: app.id,
      packageHash: app.packageHash,
      triggerId: trigger.id,
      triggerType: "everyMs" in trigger ? "heartbeat" : "cron",
      scheduledAt: scheduledAt.toISOString(),
      startedAt: now.toISOString(),
      status,
      streamMode: mode,
      lastSequence: 0,
      streamExpiresAt: new Date(now.getTime() + STREAM_RETENTION_MS).toISOString(),
    };
  }

  private async cancelPending(id: string, reason: string) {
    const queued = this.pending.get(id);
    this.pending.delete(id);
    if (!queued?.size) return;
    const now = this.now();
    for (const pending of queued.values()) {
      const record = await this.runRecord(id, pending.runId);
      record.status = "cancelled";
      record.finishedAt = now.toISOString();
      record.elapsedMs = Math.max(0, now.getTime() - Date.parse(record.startedAt));
      record.error = reason;
      await this.upsertRun(id, record);
      this.completion(record.id).resolve(structuredClone(record));
      this.completions.delete(record.id);
    }
  }

  private async stopActive(id: string, reason: string) {
    const controller = this.active.get(id);
    const runId = this.activeRunIds.get(id);
    if (!controller || !runId) return;
    controller.abort(new DOMException(reason, "AbortError"));
    await this.completion(runId).promise;
  }

  private launchTrigger(
    app: GatewayAppSummary,
    trigger: GatewayTrigger,
    scheduledAt: Date,
    record: GatewayRunRecord,
    controller: AbortController,
  ) {
    void this.executeTrigger(app, trigger, scheduledAt, record, controller).catch(async (error) => {
      if (this.active.get(app.id) === controller) {
        this.active.delete(app.id);
        this.activeRunIds.delete(app.id);
      }
      this.streams.delete(record.id);
      const current = await this.runRecord(app.id, record.id).catch(() => record);
      if (current.status !== "queued" && current.status !== "running") return;
      const reason = controller.signal.aborted ? controller.signal.reason ?? error : error;
      current.status = reason instanceof DOMException && reason.name === "AbortError" ? "cancelled" : "failed";
      current.error = errorText(reason);
      current.finishedAt = this.now().toISOString();
      current.elapsedMs = Math.max(0, this.now().getTime() - Date.parse(current.startedAt));
      await this.upsertRun(app.id, current).catch(() => {});
      this.completions.get(record.id)?.resolve(structuredClone(current));
      this.completions.delete(record.id);
    });
  }

  private async startTrigger(app: GatewayAppSummary, trigger: GatewayTrigger, scheduledAt: Date, mode: AiStreamMode): Promise<GatewayRunTicket> {
    if (this.active.has(app.id)) {
      const queue = this.pending.get(app.id) ?? new Map();
      const existing = queue.get(trigger.id);
      if (existing) return { runId: existing.runId, status: "queued", coalesced: true };
      const runId = randomUUID();
      this.completion(runId);
      queue.set(trigger.id, { runId, trigger, scheduledAt, mode });
      this.pending.set(app.id, queue);
      await this.upsertRun(app.id, this.baseRunRecord(app, trigger, scheduledAt, runId, mode, "queued"));
      return { runId, status: "queued", coalesced: false };
    }
    const controller = new AbortController();
    this.active.set(app.id, controller);
    const runId = randomUUID();
    this.completion(runId);
    const record = this.baseRunRecord(app, trigger, scheduledAt, runId, mode, "running");
    try { await this.upsertRun(app.id, record); }
    catch (error) { this.active.delete(app.id); throw error; }
    this.activeRunIds.set(app.id, runId);
    this.launchTrigger(app, trigger, scheduledAt, record, controller);
    return { runId, status: "running", coalesced: false };
  }

  private async executeTrigger(
    app: GatewayAppSummary,
    trigger: GatewayTrigger,
    scheduledAt: Date,
    record: GatewayRunRecord,
    controller: AbortController,
  ) {
    const started = this.now();
    record.status = "running";
    record.startedAt = started.toISOString();
    await this.upsertRun(app.id, record);
    const runs = await readJson<GatewayRunRecord[]>(this.statePath(app.id, "runs.json"), []);
    const triggerContext: BackgroundTriggerContext = {
      type: "everyMs" in trigger ? "heartbeat" : "cron", id: trigger.id,
      scheduledAt: scheduledAt.toISOString(), firedAt: started.toISOString(), appId: app.id, packageHash: app.packageHash, runId: record.id, attempt: 1,
      ...(this.previousRun(runs, trigger.id) ? { previous: this.previousRun(runs, trigger.id) } : {}),
    };
    await rm(this.streamPath(app.id, record.id), { force: true });
    const stream = this.createStreamState(app, record, controller);
    try {
      const sessions = await readJson<TriggerSessions>(this.statePath(app.id, "sessions.json"), {});
      const session = sessions[trigger.id]?.packageHash === app.packageHash ? sessions[trigger.id] : { messages: [], packageHash: app.packageHash };
      const result = await executeGatewayTrigger(join(this.appDirectory(app.id), "app.ai"), this.options.runtime, {
          input: trigger.input,
          variables: trigger.variables,
          signal: controller.signal,
          renderer: false,
          mode: record.streamMode,
          ...(record.streamMode === "events"
            ? { onStreamEvent: (event: AiStreamEvent) => { this.appendStream(stream, event); } }
            : { onOutputDelta: (text: string) => { this.appendStream(stream, text); } }),
        }, {
          trigger: triggerContext, history: session.messages,
          contact: (request) => this.recordContact(app, request),
        });
      await stream.tail;
      session.messages.push({ role: "user", content: trigger.input }, { role: "assistant", content: summary(result.output, 64_000) });
      session.messages = session.messages.slice(-(app.background.historyWindow ?? 20));
      sessions[trigger.id] = session;
      await atomicWrite(this.statePath(app.id, "sessions.json"), `${JSON.stringify(sessions, null, 2)}\n`);
      record.status = "completed";
      record.outputSummary = summary(result.output);
    } catch (error) {
      try { await stream.tail; } catch (streamError) { error = streamError; }
      const reason = controller.signal.aborted ? controller.signal.reason ?? error : error;
      record.status = reason instanceof DOMException && reason.name === "AbortError" ? "cancelled" : "failed";
      record.error = errorText(reason);
    }
    record.lastSequence = stream.sequence;
    record.finishedAt = this.now().toISOString();
    record.elapsedMs = this.now().getTime() - started.getTime();
    await this.upsertRun(app.id, record);
    if (this.active.get(app.id) === controller) {
      this.active.delete(app.id);
      this.activeRunIds.delete(app.id);
    }
    this.streams.delete(record.id);
    this.completion(record.id).resolve(structuredClone(record));
    this.completions.delete(record.id);
    await this.cleanupStreams(app.id);
    const queued = this.pending.get(app.id);
    const next = queued?.values().next().value as PendingRun | undefined;
    if (next) {
      queued!.delete(next.trigger.id);
      if (!queued!.size) this.pending.delete(app.id);
      const current = this.registry.apps.find((item) => item.id === app.id && item.enabled);
      if (current) {
        const nextController = new AbortController();
        this.active.set(app.id, nextController);
        this.activeRunIds.set(app.id, next.runId);
        const nextRecord = await this.runRecord(app.id, next.runId);
        this.launchTrigger(current, next.trigger, next.scheduledAt, nextRecord, nextController);
      } else {
        const cancelled = await this.runRecord(app.id, next.runId);
        cancelled.status = "cancelled";
        cancelled.finishedAt = this.now().toISOString();
        cancelled.elapsedMs = 0;
        cancelled.error = "Gateway app is disabled";
        await this.upsertRun(app.id, cancelled);
        this.completion(next.runId).resolve(cancelled);
        this.completions.delete(next.runId);
      }
    }
  }

  async startRunNow(id: string, triggerId: string, options: GatewayStartRunOptions = {}) {
    const app = this.app(id);
    const trigger = this.triggers(app.background).find((item) => item.id === triggerId);
    if (!trigger) throw new AiRuntimeError("GATEWAY_TRIGGER_NOT_FOUND", `Trigger was not found: ${triggerId}`);
    const mode = options.mode ?? app.defaultStreamMode ?? "text";
    if (mode !== "text" && mode !== "events") throw new AiRuntimeError("GATEWAY_STREAM_MODE_INVALID", `Unsupported stream mode: ${mode}`);
    return this.startTrigger(app, trigger, this.now(), mode);
  }

  async watchRun(id: string, runId: string, options: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal } = {}): Promise<GatewayRunStream> {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    const initial = await this.runRecord(id, runId);
    if (Date.parse(initial.streamExpiresAt) <= this.now().getTime()
      && (initial.status === "completed" || initial.status === "failed" || initial.status === "cancelled")) {
      throw new AiRuntimeError("GATEWAY_STREAM_EXPIRED", `Gateway stream has expired: ${runId}`);
    }
    const mode = options.mode ?? initial.streamMode;
    if (mode === "events" && initial.streamMode !== "events") {
      throw new AiRuntimeError("GATEWAY_STREAM_MODE_UNAVAILABLE", "A text-only Gateway run cannot be replayed as full events");
    }
    let cursor = Math.max(0, Math.floor(options.afterSequence ?? 0));
    let consumed = false;
    const completion = this.waitForRun(id, runId);
    const self = this;
    return {
      runId,
      mode,
      get lastSequence() { return cursor; },
      completion,
      async *[Symbol.asyncIterator]() {
        if (consumed) throw new AiRuntimeError("GATEWAY_STREAM_ALREADY_CONSUMED", "Gateway run stream only supports one consumer");
        consumed = true;
        for (;;) {
          const storedFrames = await self.readStreamFrames(id, runId, cursor);
          const frames = storedFrames ?? [];
          for (const frame of frames) {
            cursor = Math.max(cursor, frame.sequence);
            if (mode === "text" && initial.streamMode === "events") {
              const event = frame.value as AiStreamEvent;
              if (event?.type !== "output-delta") continue;
              yield { sequence: frame.sequence, value: event.text };
            } else yield frame;
          }
          const current = await self.runRecord(id, runId);
          if (!storedFrames && cursor < current.lastSequence
            && (current.status === "completed" || current.status === "failed" || current.status === "cancelled")) {
            throw new AiRuntimeError("GATEWAY_STREAM_EXPIRED", `Gateway stream is no longer retained: ${runId}`);
          }
          if (storedFrames && frames.length === 0 && cursor < current.lastSequence
            && (current.status === "completed" || current.status === "failed" || current.status === "cancelled")) {
            throw new AiRuntimeError("GATEWAY_STREAM_INCOMPLETE", `Gateway stream log is incomplete: ${runId}`);
          }
          if ((current.status === "completed" || current.status === "failed" || current.status === "cancelled")
            && cursor >= current.lastSequence) break;
          await wait(50, options.signal);
        }
      },
    };
  }

  private async deliverWebhook(app: GatewayAppSummary, item: GatewayInboxItem, signal: AbortSignal) {
    if (!app.webhookUrl) throw new AiRuntimeError("GATEWAY_WEBHOOK_REQUIRED", `Webhook URL is missing for ${app.id}`);
    const secret = await this.credentials.get(app.id);
    if (!secret) throw new AiRuntimeError("GATEWAY_WEBHOOK_REQUIRED", `Webhook secret is missing for ${app.id}`);
    const payload = JSON.stringify({ id: item.id, appId: item.appId, packageHash: item.packageHash, triggerId: item.triggerId, runId: item.runId, title: item.title, body: item.body, severity: item.severity, createdAt: item.createdAt });
    const timestamp = String(Math.floor(this.now().getTime() / 1_000));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    const fetcher = createSafeOutboundFetch({ maxRedirects: 0, maxResponseBytes: 65_536, signal, fetcher: this.options.fetcher });
    const response = await fetcher(app.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-agcomm-event": item.id, "x-agcomm-timestamp": timestamp, "x-agcomm-signature": `sha256=${signature}` }, body: payload });
    if (!response.ok) throw new AiRuntimeError("GATEWAY_WEBHOOK_FAILED", `Webhook returned HTTP ${response.status}`);
  }

  private async deliverPending() {
    const now = this.now();
    for (const app of this.registry.apps) {
      await this.withStateLock(`${app.id}:notifications`, async () => {
      const deliveries = await readJson<GatewayDelivery[]>(this.statePath(app.id, "deliveries.json"), []);
      const inbox = await readJson<GatewayInboxItem[]>(this.statePath(app.id, "inbox.json"), []);
      let changed = false;
      for (const delivery of deliveries.filter((item) => item.status === "queued" && new Date(item.nextAttemptAt) <= now)) {
        const notification = inbox.find((item) => item.id === delivery.notificationId);
        if (!notification) { delivery.status = "failed"; delivery.lastError = "Inbox item was removed"; changed = true; continue; }
        const controller = new AbortController();
        try {
          if (delivery.adapterId === "webhook") await this.deliverWebhook(app, notification, controller.signal);
          else {
            const adapter = this.adapters.get(delivery.adapterId);
            if (!adapter) throw new AiRuntimeError("NOTIFICATION_ADAPTER_NOT_FOUND", `Notification adapter is unavailable: ${delivery.adapterId}`);
            await adapter.deliver(notification, { app: structuredClone(app), signal: controller.signal });
          }
          delivery.status = "delivered";
          notification.deliveryStatus = deliveries.some((item) => item.notificationId === notification.id && item !== delivery && item.status !== "delivered") ? "queued" : "delivered";
          delete delivery.lastError;
        } catch (error) {
          delivery.lastError = errorText(error);
          const delay = RETRY_DELAYS[delivery.attempts];
          delivery.attempts++;
          if (delay === undefined) { delivery.status = "failed"; notification.deliveryStatus = "failed"; }
          else delivery.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
        }
        notification.updatedAt = now.toISOString();
        changed = true;
      }
      if (changed) { await atomicWrite(this.statePath(app.id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}\n`); await atomicWrite(this.statePath(app.id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}\n`); }
      });
    }
  }

  async runNow(id: string, triggerId: string) {
    const ticket = await this.startRunNow(id, triggerId);
    await this.waitForRun(id, ticket.runId);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      await atomicWrite(join(this.root, "liveness.json"), `${JSON.stringify({ version: 1, pid: process.pid, at: now.toISOString() })}\n`);
      await this.deliverPending();
      for (const app of this.registry.apps) await this.cleanupStreams(app.id);
      for (const app of this.registry.apps.filter((item) => item.enabled)) for (const trigger of this.triggers(app.background)) {
        const scheduledAt = new Date(app.nextRuns[trigger.id] ?? this.nextRun(trigger, now).toISOString());
        if (scheduledAt > now) continue;
        app.nextRuns[trigger.id] = this.nextRun(trigger, now).toISOString();
        if ("expression" in trigger && now.getTime() - scheduledAt.getTime() > (trigger.misfireGraceMs ?? 900_000)) continue;
        void this.startTrigger(app, trigger, scheduledAt, app.defaultStreamMode ?? "text").catch(() => {
          // A persisted run record captures execution failures after scheduling succeeds.
        });
      }
      await this.saveRegistry();
    } finally { this.ticking = false; }
  }

  async start() {
    if (this.timer) return;
    await this.acquireInstanceLock();
    try {
      await this.initialize();
      const { createGatewayIpcServer } = await import("./gateway-ipc.ts");
      this.ipc = await createGatewayIpcServer(this, this.root);
      await this.tick();
      this.timer = setInterval(() => { void this.tick(); }, 30_000);
      this.timer.unref?.();
    } catch (error) { await this.releaseInstanceLock(); throw error; }
  }
  async dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ipc?.close();
    this.ipc = undefined;
    for (const id of [...this.pending.keys()]) await this.cancelPending(id, "Gateway disposed");
    const running = [...this.activeRunIds.values()].map((runId) => this.completion(runId).promise);
    for (const controller of this.active.values()) controller.abort(new DOMException("Gateway disposed", "AbortError"));
    await Promise.all(running);
    await this.releaseInstanceLock();
  }
}

export function createRuntimeGateway(options: RuntimeGatewayOptions = {}) { return new RuntimeGateway(options); }
