import { Worker } from "node:worker_threads";
import type { Plugin } from "../../../domain/flow/types.ts";
import { assertJsonSchema, assertPluginValue, encodedPluginValueBytes } from "../../../runtime/plugins/schema.ts";
import { validatePlugin } from "../../../runtime/plugins/package.ts";
import type { PluginValue } from "../../../runtime/plugins/sdk.ts";

export const RUNTIME_PERMISSIONS = [
  "filesystem:read", "filesystem:write", "document:read", "document:write",
  "clipboard:read", "clipboard:write", "screen:read",
] as const;

export type RuntimePermission = typeof RUNTIME_PERMISSIONS[number];
export type PermissionHandler = (input: PluginValue, signal: AbortSignal) => Promise<PluginValue> | PluginValue;
export type PermissionAdapter = Partial<Record<RuntimePermission, PermissionHandler>>;

type WorkerReply =
  | { type: "ready" }
  | { type: "init-error"; error: string }
  | { type: "result"; id: string; result?: PluginValue; error?: string }
  | { type: "permission"; id: string; runId: string; permission: string; input: PluginValue }
  | { type: "log"; runId: string; level: string; message: string; details?: PluginValue };

type Pending = {
  operation: string;
  signal: AbortSignal;
  resolve(value: PluginValue): void;
  reject(error: unknown): void;
};

export type PluginLog = { pluginId: string; level: string; message: string; details?: PluginValue };

export class NodePluginSandbox {
  private worker?: Worker;
  private loading?: Promise<void>;
  private active = 0;
  private readonly pending = new Map<string, Pending>();
  readonly plugin: Plugin;

  constructor(
    plugin: Plugin,
    private readonly grants: ReadonlySet<string>,
    private readonly handlers: PermissionAdapter,
    private readonly onLog?: (log: PluginLog) => void,
  ) {
    this.plugin = validatePlugin(plugin);
  }

  private async load() {
    if (this.loading) return this.loading;
    if (this.worker) return;
    const worker = new Worker(new URL("../plugin-worker.js", import.meta.url), {
      execArgv: ["--experimental-vm-modules", "--no-warnings"],
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      name: `agent-plugin:${this.plugin.id}`,
    });
    this.worker = worker;
    worker.on("message", (message: WorkerReply) => { void this.handle(message); });
    worker.on("error", (error) => this.failAll(error));
    worker.on("exit", (code) => {
      if (code !== 0 && this.pending.size) this.failAll(new Error(`Plugin worker exited with code ${code}`));
      if (this.worker === worker) {
        this.worker = undefined;
        this.loading = undefined;
      }
    });
    this.loading = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Plugin sandbox startup timed out")), 5_000);
      const ready = (message: WorkerReply) => {
        if (message.type !== "ready" && message.type !== "init-error") return;
        clearTimeout(timer);
        worker.off("message", ready);
        if (message.type === "ready") resolve();
        else reject(new Error(message.error));
      };
      worker.on("message", ready);
      worker.postMessage({ type: "init", code: this.plugin.bundleCode });
    }).catch(async (error) => {
      if (this.worker === worker) this.worker = undefined;
      this.loading = undefined;
      await this.dispose();
      throw error;
    });
    return this.loading;
  }

  private tool(operation: string) {
    return this.plugin.tools.find((tool) => tool.name === operation);
  }

  private async handle(message: WorkerReply) {
    if (message.type === "log") {
      this.onLog?.({ pluginId: this.plugin.id, level: message.level, message: message.message.slice(0, 4_096), details: message.details });
      return;
    }
    if (message.type === "permission") {
      const invocation = this.pending.get(message.runId);
      const tool = invocation && this.tool(invocation.operation);
      try {
        if (!invocation || !tool) throw new Error("Plugin invocation context expired");
        if (!this.plugin.permissions.includes(message.permission)) throw new Error(`Plugin did not declare permission: ${message.permission}`);
        if (!tool.permissions.includes(message.permission)) throw new Error(`Plugin tool did not declare permission: ${message.permission}`);
        if (!this.grants.has(message.permission)) throw new Error(`Plugin permission was not granted: ${message.permission}`);
        if (!RUNTIME_PERMISSIONS.includes(message.permission as RuntimePermission)) throw new Error(`Unknown Runtime permission: ${message.permission}`);
        const handler = this.handlers[message.permission as RuntimePermission];
        if (!handler) throw new Error(`Host does not implement permission: ${message.permission}`);
        if (invocation.signal.aborted) throw invocation.signal.reason ?? new DOMException("Aborted", "AbortError");
        const result = await handler(message.input, invocation.signal);
        assertPluginValue(result);
        this.worker?.postMessage({ type: "permission-result", id: message.id, result });
      } catch (error) {
        this.worker?.postMessage({ type: "permission-result", id: message.id, error: error instanceof Error ? error.message : "Permission denied" });
      }
      return;
    }
    if (message.type !== "result") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    this.active--;
    if (message.error) { pending.reject(new Error(message.error)); return; }
    try {
      const value = message.result ?? null;
      assertPluginValue(value);
      const tool = this.tool(pending.operation);
      if (tool?.outputSchema) assertJsonSchema(tool.outputSchema, value);
      if (encodedPluginValueBytes(value) > (this.plugin.limits?.maxOutputBytes ?? 1_048_576)) throw new Error("Plugin output exceeds size limit");
      pending.resolve(value);
    } catch (error) {
      pending.reject(error);
    }
  }

  async run(input: PluginValue, signal?: AbortSignal, operation = "run") {
    const tool = this.tool(operation);
    if (!tool) throw new Error(`Plugin did not declare tool: ${operation}`);
    assertPluginValue(input);
    if (tool.inputSchema) assertJsonSchema(tool.inputSchema, input);
    if (this.active >= (this.plugin.limits?.maxConcurrency ?? 4)) throw new Error("Plugin concurrency limit reached");
    await this.load();
    const id = crypto.randomUUID();
    const invocationSignal = signal ?? new AbortController().signal;
    if (invocationSignal.aborted) throw invocationSignal.reason ?? new DOMException("Aborted", "AbortError");
    this.active++;
    return new Promise<PluginValue>((resolve, reject) => {
      const timeoutMs = this.plugin.limits?.timeoutMs ?? 30_000;
      const timeout = setTimeout(() => {
        if (this.pending.delete(id)) this.active--;
        void this.dispose();
        reject(new Error(`Plugin execution exceeded ${timeoutMs} ms`));
      }, timeoutMs);
      const abort = () => {
        clearTimeout(timeout);
        this.worker?.postMessage({ type: "abort", id });
        if (this.pending.delete(id)) this.active--;
        reject(invocationSignal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      invocationSignal.addEventListener("abort", abort, { once: true });
      const finish = <T>(callback: (value: T) => void) => (value: T) => {
        clearTimeout(timeout);
        invocationSignal.removeEventListener("abort", abort);
        callback(value);
      };
      this.pending.set(id, { operation, signal: invocationSignal, resolve: finish(resolve), reject: finish(reject) });
      this.worker?.postMessage({ type: "run", id, pluginId: this.plugin.id, operation, input });
    });
  }

  private failAll(error: Error) {
    for (const item of this.pending.values()) item.reject(error);
    this.pending.clear();
    this.active = 0;
  }

  async dispose() {
    const worker = this.worker;
    this.worker = undefined;
    this.loading = undefined;
    if (worker) {
      worker.postMessage({ type: "dispose" });
      await worker.terminate();
    }
    this.failAll(new Error("Plugin sandbox closed"));
  }
}
