import { Worker } from "node:worker_threads";
import type { Plugin } from "../../../domain/flow/types.ts";
import { assertJsonSchema, assertPluginValue } from "../../../runtime/plugins/schema.ts";
import { validatePlugin } from "../../../runtime/plugins/package.ts";
import type { PluginValue } from "../../../runtime/plugins/sdk.ts";
import type { PermissionAdapter, PluginLog } from "./runtime/contracts/PluginPort.ts";
import { PluginInvocationRegistry } from "./runtime/plugin/PluginInvocationRegistry.ts";
import { PluginPermissionDispatcher } from "./runtime/plugin/PluginPermissionDispatcher.ts";
import { PluginResultDispatcher } from "./runtime/plugin/PluginResultDispatcher.ts";
import type { WorkerReply } from "./runtime/plugin/PluginWorkerProtocol.ts";
export { RUNTIME_PERMISSIONS } from "./runtime/contracts/PluginPort.ts";
export type { PermissionAdapter, PermissionHandler, PluginLog, RuntimePermission } from "./runtime/contracts/PluginPort.ts";

export class NodePluginSandbox {
  private worker?: Worker;
  private loading?: Promise<void>;
  private readonly invocations = new PluginInvocationRegistry();
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
    worker.on("error", (error) => this.invocations.failAll(error));
    worker.on("exit", (code) => {
      if (code !== 0 && this.invocations.size) this.invocations.failAll(new Error(`Plugin worker exited with code ${code}`));
      if (this.worker === worker) {
        this.worker = undefined;
        this.loading = undefined;
      }
    });
    this.loading = new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        worker.off("message", ready);
        worker.off("exit", exited);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const ready = (message: WorkerReply) => {
        if (message.type !== "ready" && message.type !== "init-error") return;
        if (message.type === "init-error") { fail(new Error(message.error)); return; }
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const exited = (code: number) => fail(new Error(`Plugin worker exited before startup completed with code ${code}`));
      const timer = setTimeout(() => fail(new Error("Plugin sandbox startup timed out")), 5_000);
      worker.on("message", ready);
      worker.once("exit", exited);
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
      await new PluginPermissionDispatcher(this.plugin, this.grants, this.handlers, this.invocations, (reply) => this.worker?.postMessage(reply)).dispatch(message);
      return;
    }
    if (message.type === "result") new PluginResultDispatcher(this.plugin, this.invocations).dispatch(message);
  }

  async run(input: PluginValue, signal?: AbortSignal, operation = "run") {
    const tool = this.tool(operation);
    if (!tool) throw new Error(`Plugin did not declare tool: ${operation}`);
    assertPluginValue(input);
    if (tool.inputSchema) assertJsonSchema(tool.inputSchema, input);
    if (this.invocations.size >= (this.plugin.limits?.maxConcurrency ?? 4)) throw new Error("Plugin concurrency limit reached");
    await this.load();
    const id = crypto.randomUUID();
    const invocationSignal = signal ?? new AbortController().signal;
    if (invocationSignal.aborted) throw invocationSignal.reason ?? new DOMException("Aborted", "AbortError");
    return new Promise<PluginValue>((resolve, reject) => {
      const timeoutMs = this.plugin.limits?.timeoutMs ?? 30_000;
      let settled = false;
      let timeout: NodeJS.Timeout;
      const finish = <T>(callback: (value: T) => void) => (value: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        invocationSignal.removeEventListener("abort", abort);
        callback(value);
      };
      const rejectInvocation = finish(reject);
      const abort = () => {
        this.worker?.postMessage({ type: "abort", id });
        this.invocations.remove(id);
        rejectInvocation(invocationSignal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      timeout = setTimeout(() => {
        this.invocations.remove(id);
        void this.dispose();
        rejectInvocation(new Error(`Plugin execution exceeded ${timeoutMs} ms`));
      }, timeoutMs);
      invocationSignal.addEventListener("abort", abort, { once: true });
      this.invocations.add(id, { operation, signal: invocationSignal, resolve: finish(resolve), reject: finish(reject) });
      this.worker?.postMessage({ type: "run", id, pluginId: this.plugin.id, operation, input });
    });
  }

  async dispose() {
    const worker = this.worker;
    this.worker = undefined;
    this.loading = undefined;
    if (worker) {
      worker.postMessage({ type: "dispose" });
      await worker.terminate();
    }
    this.invocations.failAll(new Error("Plugin sandbox closed"));
  }
}
