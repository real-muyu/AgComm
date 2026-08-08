// SPDX-License-Identifier: Elastic-2.0
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AiRuntimeError, type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import { GatewayLock } from "./GatewayLock.ts";
import { GatewayScheduler } from "./GatewayScheduler.ts";
import { atomicWrite, GatewayState, readJson, type GatewayInstallOptions, type GatewayRunStream, type GatewayStartRunOptions, type RuntimeGatewayOptions } from "./GatewayState.ts";
import { GatewayStream } from "./GatewayStream.ts";
import { createGatewayCredentialStore, GatewayNotifier } from "./GatewayNotifier.ts";
import { installGatewayApplication } from "./GatewayInstaller.ts";
import type { GatewayExecutor } from "./GatewayExecutor.ts";
export type { GatewayAppSummary, GatewayCredentialStore, GatewayDelivery, GatewayInboxItem, GatewayInstallOptions, GatewayRunRecord, GatewayRunStream, GatewayRunTicket, GatewayStartRunOptions, GatewayStreamFrame, NotificationAdapter, NotificationAdapterContext, RuntimeGatewayOptions } from "./GatewayState.ts";
export { createGatewayCredentialStore } from "./GatewayNotifier.ts";

function defaultRoot() { return join(homedir(), ".agcomm", "runtime", "gateway"); }

export class RuntimeGateway {
  readonly root: string;
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;
  private ipc?: { close(): Promise<void> };
  private ticking = false;
  private readonly instanceLock: GatewayLock;
  private readonly scheduler = new GatewayScheduler();
  private readonly state: GatewayState;
  private readonly stream: GatewayStream;
  private readonly executor: GatewayExecutor;
  private readonly notifier: GatewayNotifier;

  constructor(private readonly options: RuntimeGatewayOptions = {}, executor: GatewayExecutor) {
    this.root = resolve(options.root ?? defaultRoot());
    this.now = options.now ?? (() => new Date());
    this.state = new GatewayState(this.root, this.now);
    this.notifier = new GatewayNotifier(options.credentialStore ?? createGatewayCredentialStore(), options.notificationAdapters ?? [], this.state, this.now, options.fetcher);
    this.stream = new GatewayStream(this.state, this.now);
    this.instanceLock = new GatewayLock(this.root, this.now);
    this.executor = executor;
    this.executor.configure({ state: this.state, stream: this.stream, notifier: this.notifier, runtime: options.runtime, now: this.now });
    this.state.bindInstall((input, install) => installGatewayApplication({ root: this.root, runtime: this.options.runtime, registry: this.state.registry, adapters: this.notifier.adapters, now: this.now, credential: (id) => this.notifier.credentials.get(id), saveCredential: (id, secret) => this.notifier.credentials.set(id, secret), stopActive: (id, reason) => this.executor.stopActive(id, reason), cancelPending: (id, reason) => this.executor.cancelPending(id, reason), triggers: (background) => this.scheduler.triggers(background), nextRun: (trigger, after) => this.scheduler.nextRun(trigger, after), saveRegistry: () => this.state.saveRegistry(), statePath: (id, name) => this.state.statePath(id, name) }, input, install));
  }

  private async initialize() {
    await this.state.initialize();
    const now = this.now();
    for (const app of this.state.registry.apps) {
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
      if (changed) await this.state.writeRuns(app.id, runs);
      await this.stream.cleanup(app.id, runs);
    }
    await this.state.saveRegistry();
    return this;
  }

  async status() {
    const liveness = await readJson<{ pid?: number; at?: string }>(join(this.root, "liveness.json"), {});
    const heartbeatAt = typeof liveness.at === "string" ? liveness.at : undefined;
    const healthy = Boolean(heartbeatAt && this.now().getTime() - Date.parse(heartbeatAt) <= 90_000);
    return { alive: true as const, pid: liveness.pid ?? process.pid, heartbeatAt, healthy };
  }

  install(pathOrBytes: string | Uint8Array | ArrayBuffer, install: GatewayInstallOptions = {}) { return this.state.install(pathOrBytes, install); }
  async enable(id: string) { const app = this.state.app(id); app.enabled = true; app.updatedAt = this.now().toISOString(); for (const trigger of this.scheduler.triggers(app.background)) app.nextRuns[trigger.id] = this.scheduler.nextRun(trigger, this.now()).toISOString(); await this.state.saveRegistry(); }
  async disable(id: string) {
    const app = this.state.app(id);
    app.enabled = false;
    app.updatedAt = this.now().toISOString();
    await this.executor.stopActive(id, "Gateway app disabled");
    await this.executor.cancelPending(id, "Gateway app is disabled");
    await this.state.saveRegistry();
  }
  async uninstall(id: string) {
    this.state.app(id);
    await this.executor.stopActive(id, "Gateway app uninstalled");
    await this.executor.cancelPending(id, "Gateway app was uninstalled");
    this.state.registry.apps = this.state.registry.apps.filter((app) => app.id !== id);
    await this.state.saveRegistry();
    await this.notifier.credentials.delete(id);
    await rm(this.state.appDirectory(id), { recursive: true, force: true });
  }
  async listApps() { return this.state.listApps(); }
  async listRuns(id: string) { return this.state.listRuns(id); }
  async listInbox(id: string) { return this.notifier.listInbox(id); }
  async markInboxRead(id: string, notificationIds: readonly string[]) { return this.notifier.markRead(id, notificationIds); }
  async retryDelivery(id: string, notificationId: string) { return this.notifier.retry(id, notificationId); }

  async startRunNow(id: string, triggerId: string, options: GatewayStartRunOptions = {}) {
    const app = this.state.app(id);
    const trigger = this.scheduler.triggers(app.background).find((item) => item.id === triggerId);
    if (!trigger) throw new AiRuntimeError("GATEWAY_TRIGGER_NOT_FOUND", `Trigger was not found: ${triggerId}`);
    const mode = options.mode ?? app.defaultStreamMode ?? "text";
    if (mode !== "text" && mode !== "events") throw new AiRuntimeError("GATEWAY_STREAM_MODE_INVALID", `Unsupported stream mode: ${mode}`);
    return this.executor.start(app, trigger, this.now(), mode);
  }

  watchRun(id: string, runId: string, options: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal } = {}): Promise<GatewayRunStream> { return this.stream.watch(id, runId, options) as Promise<GatewayRunStream>; }
  async runNow(id: string, triggerId: string) {
    const ticket = await this.startRunNow(id, triggerId);
    const record = await this.state.runRecord(id, ticket.runId);
    if (record.status === "queued" || record.status === "running") await this.stream.completion(ticket.runId).promise;
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      await atomicWrite(join(this.root, "liveness.json"), `${JSON.stringify({ version: 1, pid: process.pid, at: now.toISOString() })}\n`);
      await this.notifier.deliverPending();
      for (const app of this.state.registry.apps) await this.stream.cleanup(app.id);
      for (const app of this.state.registry.apps.filter((item) => item.enabled)) for (const trigger of this.scheduler.triggers(app.background)) {
        const scheduledAt = new Date(app.nextRuns[trigger.id] ?? this.scheduler.nextRun(trigger, now).toISOString());
        if (scheduledAt > now) continue;
        app.nextRuns[trigger.id] = this.scheduler.nextRun(trigger, now).toISOString();
        if ("expression" in trigger && now.getTime() - scheduledAt.getTime() > (trigger.misfireGraceMs ?? 900_000)) continue;
        void this.executor.start(app, trigger, scheduledAt, app.defaultStreamMode ?? "text").catch(() => {
          // A persisted run record captures execution failures after scheduling succeeds.
        });
      }
      await this.state.saveRegistry();
    } finally { this.ticking = false; }
  }

  async start() {
    if (this.timer) return;
    await this.instanceLock.acquire();
    try {
      await this.initialize();
      const { createGatewayIpcServer } = await import("../ipc/GatewayIpcServer.ts");
      this.ipc = await createGatewayIpcServer(this, this.root);
      await this.tick();
      this.timer = setInterval(() => { void this.tick(); }, 30_000);
      this.timer.unref?.();
    } catch (error) { await this.instanceLock.release(); throw error; }
  }
  async dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ipc?.close();
    this.ipc = undefined;
    for (const id of [...this.executor.pending.keys()]) await this.executor.cancelPending(id, "Gateway disposed");
    const running = [...this.executor.activeRunIds.values()].map((runId) => this.stream.completion(runId).promise);
    for (const controller of this.executor.active.values()) controller.abort(new DOMException("Gateway disposed", "AbortError"));
    await Promise.all(running);
    await this.instanceLock.release();
  }
}
