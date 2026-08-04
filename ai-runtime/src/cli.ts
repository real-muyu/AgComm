#!/usr/bin/env node
import {
  AiRuntimeError,
  confirmTerminalGateway,
  createLineRenderer,
  createNativePermissionAdapter,
  createPersistentTrustProvider,
  createRuntime,
  createTerminalRenderer,
  LocalRuntimeConfigStore,
  promptTerminalTrust,
  runTerminalApp,
  runTerminalLauncher,
  runTerminalSettings,
  selectTerminalPermissionPath,
  type ProviderConfig,
  type AiRunStream,
  type RuntimeRenderer,
} from "./index.ts";
import { loadGatewayModule, type GatewayInstanceLike } from "./gateway-loader.ts";
import { collectHttpProviderSecrets, type HttpModelProviderConfig } from "./http-provider.ts";
import { cliAbortController as controller, cliInterrupted as interrupted } from "./cli-signal.ts";

type CliArguments = { file?: string; open: boolean; input?: string; variables?: Record<string, unknown>; headless: boolean; batch: boolean; json: boolean; stream: boolean; allowUnsignedPlugins: boolean };
declare const __AI_RUNTIME_VERSION__: string;
const RUNTIME_VERSION = __AI_RUNTIME_VERSION__;

class CliError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CliError";
  }
}

function usage() {
  return "Usage: agcomm <file.ai> [options]\n       agcomm open [options]\n       agcomm gateway run\nOptions: --input <text> --vars <json> --headless --batch --json --stream --allow-unsigned-plugins --version";
}

function jsonObject(text: string, subject: string) {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new CliError("INVALID_JSON", `${subject} must be valid JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("INVALID_JSON", `${subject} must be a JSON object`);
  return value as Record<string, unknown>;
}

function parseArguments(argv: string[]): CliArguments {
  if (argv.includes("--help") || argv.includes("-h")) throw new CliError("HELP", usage());
  let file = "";
  let open = false;
  let input: string | undefined;
  let variables: Record<string, unknown> | undefined;
  let headless = false;
  let batch = false;
  let json = false;
  let stream = false;
  let allowUnsignedPlugins = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--headless") { headless = true; continue; }
    if (argument === "--batch") { batch = true; continue; }
    if (argument === "--json") { json = true; continue; }
    if (argument === "--stream") { stream = true; continue; }
    if (argument === "--allow-unsigned-plugins") { allowUnsignedPlugins = true; continue; }
    if (argument === "--input" || argument === "--vars") {
      const value = argv[++index];
      if (value === undefined) throw new CliError("INVALID_ARGUMENTS", `${argument} requires a value`);
      if (argument === "--input") input = value;
      else variables = jsonObject(value, "--vars");
      continue;
    }
    if (argument.startsWith("-")) throw new CliError("INVALID_ARGUMENTS", `Unknown option: ${argument}`);
    if (argument === "open") {
      if (file || open) throw new CliError("INVALID_ARGUMENTS", "Choose either agcomm open or one .ai file");
      open = true;
      continue;
    }
    if (file || open) throw new CliError("INVALID_ARGUMENTS", "Choose either agcomm open or one .ai file");
    file = argument;
  }
  if (!file && !open) throw new CliError("INVALID_ARGUMENTS", usage());
  if (file && !/\.ai$/i.test(file)) throw new CliError("INVALID_ARGUMENTS", "Input file must use the .ai extension");
  if (headless && batch) throw new CliError("INVALID_ARGUMENTS", "--headless and --batch cannot be used together");
  if (stream && json) throw new CliError("INVALID_ARGUMENTS", "--stream and --json cannot be used together");
  if (stream && open) throw new CliError("INVALID_ARGUMENTS", "--stream requires an explicit .ai file path");
  return { ...(file ? { file } : {}), open, input, variables, headless, batch, json, stream, allowUnsignedPlugins };
}

function envObject(name: string) {
  const value = process.env[name];
  return value ? jsonObject(value, name) : {};
}

function grantsFromEnvironment() {
  const value = envObject("AI_PLUGIN_GRANTS");
  const grants: Record<string, string[]> = {};
  for (const [pluginId, permissions] of Object.entries(value)) {
    if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== "string")) {
      throw new CliError("INVALID_ENVIRONMENT", `AI_PLUGIN_GRANTS.${pluginId} must be an array of strings`);
    }
    grants[pluginId] = permissions as string[];
  }
  return grants;
}

function trustedKeysFromEnvironment() {
  const value = envObject("AI_PLUGIN_TRUSTED_KEYS");
  const keys: Record<string, string> = {};
  for (const [keyId, publicKey] of Object.entries(value)) {
    if (typeof publicKey !== "string" || !publicKey.trim()) throw new CliError("INVALID_ENVIRONMENT", `AI_PLUGIN_TRUSTED_KEYS.${keyId} must be a base64 string`);
    keys[keyId] = publicKey;
  }
  return keys;
}

function httpProviderFromEnvironment(): HttpModelProviderConfig | undefined {
  const connectionId = process.env.AI_MODEL_CONNECTION?.trim();
  if (!connectionId) return undefined;
  const encoded = process.env.AI_HTTP_CONNECTIONS;
  if (!encoded) throw new AiRuntimeError("HTTP_CONNECTION_NOT_FOUND", `AI_HTTP_CONNECTIONS does not define selected connection ${connectionId}`);
  let connections: Record<string, unknown>;
  try { connections = jsonObject(encoded, "AI_HTTP_CONNECTIONS"); }
  catch (error) { throw new AiRuntimeError("HTTP_CONNECTION_INVALID", "AI_HTTP_CONNECTIONS must be a JSON object", { cause: error }); }
  const selected = connections[connectionId];
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) throw new AiRuntimeError("HTTP_CONNECTION_NOT_FOUND", `HTTP model connection was not found: ${connectionId}`);
  return { ...(selected as Omit<HttpModelProviderConfig, "type">), type: "http", environment: process.env };
}

async function localProvider(store: LocalRuntimeConfigStore): Promise<ProviderConfig> {
  const profile = await store.selectedProfile();
  let storedSecret: string | undefined;
  if (profile && !process.env.OPENAI_API_KEY) {
    try { storedSecret = await store.credentials.get(profile.id); }
    catch (error) {
      if (error instanceof AiRuntimeError && error.code === "NATIVE_CREDENTIAL_UNAVAILABLE") throw error;
    }
  }
  return {
    apiKey: process.env.OPENAI_API_KEY ?? storedSecret,
    baseUrl: process.env.OPENAI_BASE_URL ?? profile?.baseUrl,
    model: process.env.OPENAI_MODEL ?? profile?.model,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? profile?.embeddingModel,
  };
}

const redactionSecrets = new Set<string>();
if (process.env.OPENAI_API_KEY) redactionSecrets.add(process.env.OPENAI_API_KEY);

function redactedMessage(error: unknown) {
  let message = error instanceof Error ? error.message : String(error || "Unknown failure");
  for (const secret of redactionSecrets) if (secret) message = message.split(secret).join("[REDACTED]");
  return message.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]").slice(0, 4_096);
}

function classify(error: unknown, interrupted: boolean) {
  if (interrupted) return { code: "CANCELLED", exitCode: 130 };
  if (error instanceof CliError) return { code: error.code, exitCode: error.code === "HELP" ? 0 : 2 };
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof AiRuntimeError) return { code: current.code, exitCode: current.code.startsWith("PLUGIN_") ? 3 : 4 };
    current = current.cause;
  }
  const value = error as { code?: unknown; name?: unknown; phase?: unknown };
  if (value?.name === "AiPackageValidationError") return { code: String(value.code || "PACKAGE_INVALID"), exitCode: 3 };
  if (value?.code === "ENOENT") return { code: "FILE_NOT_FOUND", exitCode: 2 };
  if (value?.name === "FlowValidationError") return { code: "FLOW_INVALID", exitCode: 3 };
  if (value?.name === "FlowCancelledError" || value?.name === "AbortError") return { code: "CANCELLED", exitCode: 130 };
  if (value?.name === "FlowTimeoutError" || /timeout/i.test(redactedMessage(error))) return { code: "TIMEOUT", exitCode: 4 };
  return { code: "RUNTIME_FAILED", exitCode: 4 };
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

let runtime: ReturnType<typeof createRuntime> | undefined;
let gateway: GatewayInstanceLike | undefined;
let renderer: RuntimeRenderer | undefined;
let rendererManaged = false;
let emitJson = true;
let emitStream = false;
try {
  const rawArguments = process.argv.slice(2);
  if (rawArguments.length === 1 && (rawArguments[0] === "--version" || rawArguments[0] === "-v")) {
    process.stdout.write(`${RUNTIME_VERSION}\n`);
  } else if (rawArguments[0] === "gateway") {
    if (rawArguments.length !== 2 || rawArguments[1] !== "run") throw new CliError("INVALID_ARGUMENTS", "Usage: agcomm gateway run");
    emitJson = false;
    const localStore = new LocalRuntimeConfigStore();
    const httpProvider = httpProviderFromEnvironment();
    const profileProvider = httpProvider ? undefined : await localProvider(localStore);
    const provider = httpProvider ?? profileProvider!;
    const trustProvider = createPersistentTrustProvider(localStore, async () => ({ trusted: false }));
    const { createRuntimeGateway } = await loadGatewayModule();
    gateway = createRuntimeGateway({ runtime: {
      provider,
      trustedKeys: { ...(await localStore.trustedKeys()), ...trustedKeysFromEnvironment() },
      grants: grantsFromEnvironment(),
      permissions: createNativePermissionAdapter(),
      trustProvider,
    } });
    await gateway.start();
    await new Promise<void>((resolveStop) => {
      if (controller.signal.aborted) resolveStop();
      else controller.signal.addEventListener("abort", () => resolveStop(), { once: true });
    });
  } else {
  emitStream = rawArguments.includes("--stream");
  if (emitStream) emitJson = false;
  const args = parseArguments(rawArguments);
  if (args.allowUnsignedPlugins) process.stderr.write("Warning: unsigned plugins are allowed for this run. Only execute .ai files you trust.\n");
  const textTerminal = process.stdin.isTTY === true && process.stderr.isTTY === true;
  const fullScreen = !args.stream && !args.headless && !args.batch && textTerminal && process.env.TERM !== "dumb";
  if (args.open && !fullScreen) throw new CliError("INTERACTIVE_TERMINAL_REQUIRED", "agcomm open requires a full interactive terminal");
  const localStore = new LocalRuntimeConfigStore();
  const selectedFile = args.open ? await runTerminalLauncher(localStore, { signal: controller.signal }) : args.file;
  if (!selectedFile) {
    emitJson = false;
    process.exitCode = 0;
  } else {
    emitJson = !args.stream && (!fullScreen || args.json);
    renderer = args.stream
      ? createLineRenderer({ interactive: false, formatError: redactedMessage })
      : fullScreen
      ? createTerminalRenderer({ formatError: redactedMessage })
      : args.headless
        ? createLineRenderer({ interactive: textTerminal, formatError: redactedMessage })
        : undefined;
    const httpProvider = httpProviderFromEnvironment();
    if (httpProvider) for (const secret of collectHttpProviderSecrets(httpProvider, process.env)) redactionSecrets.add(secret);
    const profileProvider = httpProvider ? undefined : await localProvider(localStore);
    const provider = httpProvider ?? profileProvider!;
    if (profileProvider?.apiKey) redactionSecrets.add(profileProvider.apiKey);
    const interactiveTrust = fullScreen
      ? createPersistentTrustProvider(localStore, (request) => promptTerminalTrust(request, { signal: controller.signal }))
      : undefined;
    const permissions = createNativePermissionAdapter(fullScreen ? {
      selectPath: (request, signal) => selectTerminalPermissionPath(request, signal),
    } : {});
    runtime = createRuntime({
      provider,
      trustedKeys: { ...(await localStore.trustedKeys()), ...trustedKeysFromEnvironment() },
      grants: grantsFromEnvironment(),
      permissions,
      allowUnsignedPlugins: args.allowUnsignedPlugins,
      trustProvider: interactiveTrust,
    });
    rendererManaged = true;
    if (fullScreen && !args.json) {
      const app = await runtime.openAiApp(selectedFile);
      try {
        const gatewayAccepted = await confirmTerminalGateway(app.info, selectedFile, { signal: controller.signal, preflight: () => app.preflight() });
        if (!gatewayAccepted) {
          emitJson = false;
          process.exitCode = 0;
        } else {
          const interactive = Boolean(app.interaction?.conversation?.multiTurn || app.interaction?.conversation?.history || app.interaction?.knowledge);
          if (interactive) await runTerminalApp(app, {
            initialInput: args.input, variables: args.variables, signal: controller.signal, formatError: redactedMessage,
            openSettings: () => runTerminalSettings(localStore, { signal: controller.signal }),
          });
          else await app.run({ input: args.input, variables: args.variables, signal: controller.signal, renderer });
        }
      } finally { await app.dispose(); }
    } else if (args.stream) {
      const stream = await runtime.streamAiFile(selectedFile, {
        mode: "text",
        input: args.input,
        variables: args.variables,
        signal: controller.signal,
        renderer,
      }) as AiRunStream<string>;
      let last = "";
      for await (const chunk of stream) {
        last = chunk;
        process.stdout.write(chunk);
      }
      await stream.result;
      if (!last.endsWith("\n")) process.stdout.write("\n");
    } else {
      const result = await runtime.runAiFile(selectedFile, { input: args.input, variables: args.variables, signal: controller.signal, renderer });
      if (emitJson) writeJson(result);
    }
  }
  }
} catch (error) {
  if (renderer && !rendererManaged) {
    try { await renderer.fail?.(error); } catch { /* Preserve the original error. */ }
    try { await renderer.dispose?.(); } catch { /* Best-effort terminal cleanup. */ }
  }
  const failure = classify(error, interrupted);
  const value = error as { issues?: unknown; phase?: unknown };
  if (emitJson) {
    writeJson({
      ok: false,
      error: {
        code: failure.code,
        message: redactedMessage(error),
        ...(value?.phase ? { phase: value.phase } : {}),
        ...(Array.isArray(value?.issues) ? { issues: value.issues } : {}),
      },
    });
  } else if (emitStream) process.stderr.write(`agcomm: ${failure.code}: ${redactedMessage(error)}\n`);
  process.exitCode = failure.exitCode;
} finally {
  await runtime?.dispose();
  await gateway?.dispose();
}
