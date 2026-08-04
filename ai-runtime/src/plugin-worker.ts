import * as vm from "node:vm";
import { webcrypto } from "node:crypto";
import { parentPort } from "node:worker_threads";

if (!parentPort) throw new Error("Plugin worker requires a parent port");
const port = parentPort;

type PluginValue = null | boolean | number | string | PluginValue[] | { [key: string]: PluginValue };
type HostMessage =
  | { type: "init"; code: string }
  | { type: "run"; id: string; pluginId: string; operation: string; input: PluginValue }
  | { type: "permission-result"; id: string; result?: PluginValue; error?: string }
  | { type: "abort"; id: string }
  | { type: "dispose" };

type Plugin = {
  run?: (input: PluginValue, context: PluginContext) => Promise<PluginValue> | PluginValue;
  tools?: Record<string, { run(input: PluginValue, context: PluginContext): Promise<PluginValue> | PluginValue }>;
  dispose?: () => Promise<void> | void;
};

type PluginContext = {
  pluginId: string;
  signal: AbortSignal;
  checkAborted(): void;
  call(permission: string, input?: PluginValue): Promise<PluginValue>;
  log(level: string, message: string, details?: PluginValue): void;
};

let plugin: Plugin | undefined;
const controllers = new Map<string, AbortController>();
const permissions = new Map<string, { resolve(value: PluginValue): void; reject(error: unknown): void }>();

function failure(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Plugin failed");
}

async function loadPlugin(code: string) {
  const context = vm.createContext({
    AbortController,
    AbortSignal,
    DOMException,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
    atob,
    btoa,
    clearInterval,
    clearTimeout,
    crypto: webcrypto,
    queueMicrotask,
    setInterval,
    setTimeout,
    structuredClone,
  }, {
    name: "agcomm-plugin",
    codeGeneration: { strings: false, wasm: false },
  });
  const module = new vm.SourceTextModule(code, {
    context,
    identifier: "agent-plugin:bundle",
    initializeImportMeta(meta) { meta.url = "agent-plugin:bundle"; },
    importModuleDynamically() { throw new Error("Plugin dynamic import is disabled"); },
  });
  await module.link((specifier) => { throw new Error(`Plugin import is disabled: ${specifier}`); });
  await module.evaluate({ timeout: 5_000 });
  const loaded = (module.namespace as unknown as { default?: Plugin }).default;
  if (!loaded || (typeof loaded.run !== "function" && (!loaded.tools || typeof loaded.tools !== "object"))) {
    throw new Error("Plugin must export run() or tools");
  }
  plugin = loaded;
}

port.on("message", async (message: HostMessage) => {
  if (message.type === "init") {
    try {
      await loadPlugin(message.code);
      port.postMessage({ type: "ready" });
    } catch (error) {
      port.postMessage({ type: "init-error", error: failure(error) });
    }
    return;
  }
  if (message.type === "permission-result") {
    const pending = permissions.get(message.id);
    if (!pending) return;
    permissions.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result ?? null);
    return;
  }
  if (message.type === "abort") {
    controllers.get(message.id)?.abort(new DOMException("Plugin invocation aborted", "AbortError"));
    return;
  }
  if (message.type === "dispose") {
    try { await plugin?.dispose?.(); } finally { process.exit(0); }
  }
  if (message.type !== "run") return;

  const controller = new AbortController();
  controllers.set(message.id, controller);
  const context: PluginContext = {
    pluginId: message.pluginId,
    signal: controller.signal,
    checkAborted() {
      if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException("Aborted", "AbortError");
    },
    call(permission, input = null) {
      context.checkAborted();
      const id = webcrypto.randomUUID();
      port.postMessage({ type: "permission", id, runId: message.id, permission, input });
      return new Promise((resolve, reject) => permissions.set(id, { resolve, reject }));
    },
    log(level, text, details) {
      port.postMessage({ type: "log", runId: message.id, level: String(level), message: String(text), details });
    },
  };

  try {
    const handler = message.operation === "run" && typeof plugin?.run === "function"
      ? plugin.run.bind(plugin)
      : plugin?.tools?.[message.operation]?.run?.bind(plugin.tools[message.operation]);
    if (!handler) throw new Error(`Plugin operation is not implemented: ${message.operation}`);
    const result = await handler(message.input, context);
    port.postMessage({ type: "result", id: message.id, result: result ?? null });
  } catch (error) {
    port.postMessage({ type: "result", id: message.id, error: failure(error) });
  } finally {
    controllers.delete(message.id);
  }
});
