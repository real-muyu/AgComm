#!/usr/bin/env node
import {
  cliAbortController,
  cliInterrupted,
  disposeCliSignals
} from "./chunk-NJKAJY47-bundle.js";
import {
  AiRuntimeError,
  LocalRuntimeConfigStore,
  collectHttpProviderSecrets,
  confirmTerminalGateway,
  createLineRenderer,
  createNativePermissionAdapter,
  createPersistentTrustProvider,
  createRuntimeKernel,
  createTerminalRenderer,
  promptTerminalTrust,
  runTerminalApp,
  runTerminalLauncher,
  runTerminalSettings,
  selectTerminalPermissionPath,
  startRuntimeGateway
} from "./chunk-V5FW7JF6-bundle.js";
import "./chunk-MZWYF3I5-bundle.js";

// src/cli.ts
var RUNTIME_VERSION = "0.8.0";
var CliError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "CliError";
  }
  code;
};
function usage() {
  return "Usage: agcomm <file.ai> [options]\n       agcomm open [options]\n       agcomm gateway run\nOptions: --input <text> --vars <json> --headless --batch --json --stream --allow-unsigned-plugins --version";
}
function jsonObject(text, subject) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError("INVALID_JSON", `${subject} must be valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("INVALID_JSON", `${subject} must be a JSON object`);
  return value;
}
var BOOLEAN_OPTIONS = {
  "--headless": "headless",
  "--batch": "batch",
  "--json": "json",
  "--stream": "stream",
  "--allow-unsigned-plugins": "allowUnsignedPlugins"
};
function initialCliArguments() {
  return { file: "", open: false, headless: false, batch: false, json: false, stream: false, allowUnsignedPlugins: false };
}
function parseOption(argv, index, args) {
  const option = argv[index];
  const booleanKey = BOOLEAN_OPTIONS[option];
  if (booleanKey) {
    args[booleanKey] = true;
    return index;
  }
  if (option !== "--input" && option !== "--vars") {
    throw new CliError("INVALID_ARGUMENTS", `Unknown option: ${option}`);
  }
  const value = argv[index + 1];
  if (value === void 0) throw new CliError("INVALID_ARGUMENTS", `${option} requires a value`);
  if (option === "--input") args.input = value;
  else args.variables = jsonObject(value, "--vars");
  return index + 1;
}
function parseTarget(argument, args) {
  if (args.file || args.open) throw new CliError("INVALID_ARGUMENTS", "Choose either agcomm open or one .ai file");
  if (argument === "open") args.open = true;
  else args.file = argument;
}
function validateCliArguments(args) {
  if (!args.file && !args.open) throw new CliError("INVALID_ARGUMENTS", usage());
  if (args.file && !/\.ai$/i.test(args.file)) throw new CliError("INVALID_ARGUMENTS", "Input file must use the .ai extension");
  if (args.headless && args.batch) throw new CliError("INVALID_ARGUMENTS", "--headless and --batch cannot be used together");
  if (args.stream && args.json) throw new CliError("INVALID_ARGUMENTS", "--stream and --json cannot be used together");
  if (args.stream && args.open) throw new CliError("INVALID_ARGUMENTS", "--stream requires an explicit .ai file path");
}
function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) throw new CliError("HELP", usage());
  const args = initialCliArguments();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument.startsWith("-")) index = parseOption(argv, index, args);
    else parseTarget(argument, args);
  }
  validateCliArguments(args);
  const { file, ...result } = args;
  return file ? { file, ...result } : result;
}
function envObject(name) {
  const value = process.env[name];
  return value ? jsonObject(value, name) : {};
}
function grantsFromEnvironment() {
  const value = envObject("AI_PLUGIN_GRANTS");
  const grants = {};
  for (const [pluginId, permissions] of Object.entries(value)) {
    if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== "string")) {
      throw new CliError("INVALID_ENVIRONMENT", `AI_PLUGIN_GRANTS.${pluginId} must be an array of strings`);
    }
    grants[pluginId] = permissions;
  }
  return grants;
}
function trustedKeysFromEnvironment() {
  const value = envObject("AI_PLUGIN_TRUSTED_KEYS");
  const keys = {};
  for (const [keyId, publicKey] of Object.entries(value)) {
    if (typeof publicKey !== "string" || !publicKey.trim()) throw new CliError("INVALID_ENVIRONMENT", `AI_PLUGIN_TRUSTED_KEYS.${keyId} must be a base64 string`);
    keys[keyId] = publicKey;
  }
  return keys;
}
function httpProviderFromEnvironment() {
  const connectionId = process.env.AI_MODEL_CONNECTION?.trim();
  if (!connectionId) return void 0;
  const encoded = process.env.AI_HTTP_CONNECTIONS;
  if (!encoded) throw new AiRuntimeError("HTTP_CONNECTION_NOT_FOUND", `AI_HTTP_CONNECTIONS does not define selected connection ${connectionId}`);
  let connections;
  try {
    connections = jsonObject(encoded, "AI_HTTP_CONNECTIONS");
  } catch (error) {
    throw new AiRuntimeError("HTTP_CONNECTION_INVALID", "AI_HTTP_CONNECTIONS must be a JSON object", { cause: error });
  }
  const selected = connections[connectionId];
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) throw new AiRuntimeError("HTTP_CONNECTION_NOT_FOUND", `HTTP model connection was not found: ${connectionId}`);
  return { ...selected, type: "http", environment: process.env };
}
async function localProvider(store) {
  const profile = await store.selectedProfile();
  let storedSecret;
  if (profile && !process.env.OPENAI_API_KEY) {
    try {
      storedSecret = await store.credentials.get(profile.id);
    } catch (error) {
      if (error instanceof AiRuntimeError && error.code === "NATIVE_CREDENTIAL_UNAVAILABLE") throw error;
    }
  }
  return {
    apiKey: process.env.OPENAI_API_KEY ?? storedSecret,
    baseUrl: process.env.OPENAI_BASE_URL ?? profile?.baseUrl,
    model: process.env.OPENAI_MODEL ?? profile?.model,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? profile?.embeddingModel
  };
}
var redactionSecrets = /* @__PURE__ */ new Set();
if (process.env.OPENAI_API_KEY) redactionSecrets.add(process.env.OPENAI_API_KEY);
function redactedMessage(error) {
  let message = error instanceof Error ? error.message : String(error || "Unknown failure");
  for (const secret of redactionSecrets) if (secret) message = message.split(secret).join("[REDACTED]");
  return message.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]").slice(0, 4096);
}
function classify(error, interrupted) {
  if (interrupted) return { code: "CANCELLED", exitCode: 130 };
  if (error instanceof CliError) return { code: error.code, exitCode: error.code === "HELP" ? 0 : 2 };
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof AiRuntimeError) return { code: current.code, exitCode: current.code.startsWith("PLUGIN_") ? 3 : 4 };
    current = current.cause;
  }
  const value = error;
  if (value?.name === "AiPackageValidationError") return { code: String(value.code || "PACKAGE_INVALID"), exitCode: 3 };
  if (value?.code === "ENOENT") return { code: "FILE_NOT_FOUND", exitCode: 2 };
  if (value?.name === "FlowValidationError") return { code: "FLOW_INVALID", exitCode: 3 };
  if (value?.name === "FlowCancelledError" || value?.name === "AbortError") return { code: "CANCELLED", exitCode: 130 };
  if (value?.name === "FlowTimeoutError" || /timeout/i.test(redactedMessage(error))) return { code: "TIMEOUT", exitCode: 4 };
  return { code: "RUNTIME_FAILED", exitCode: 4 };
}
function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}
`);
}
var runtime;
var gateway;
var renderer;
var rendererManaged = false;
var emitJson = true;
var emitStream = false;
try {
  const rawArguments = process.argv.slice(2);
  if (rawArguments.length === 1 && (rawArguments[0] === "--version" || rawArguments[0] === "-v")) {
    process.stdout.write(`${RUNTIME_VERSION}
`);
  } else if (rawArguments[0] === "gateway") {
    if (rawArguments.length !== 2 || rawArguments[1] !== "run") throw new CliError("INVALID_ARGUMENTS", "Usage: agcomm gateway run");
    emitJson = false;
    const localStore = new LocalRuntimeConfigStore();
    const httpProvider = httpProviderFromEnvironment();
    const profileProvider = httpProvider ? void 0 : await localProvider(localStore);
    const provider = httpProvider ?? profileProvider;
    const trustProvider = createPersistentTrustProvider(localStore, async () => ({ trusted: false }));
    gateway = await startRuntimeGateway({ runtime: {
      provider,
      trustedKeys: { ...await localStore.trustedKeys(), ...trustedKeysFromEnvironment() },
      grants: grantsFromEnvironment(),
      permissions: createNativePermissionAdapter(),
      trustProvider
    } });
    await gateway.start();
    await new Promise((resolveStop) => {
      if (cliAbortController.signal.aborted) resolveStop();
      else cliAbortController.signal.addEventListener("abort", () => resolveStop(), { once: true });
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
    const selectedFile = args.open ? await runTerminalLauncher(localStore, { signal: cliAbortController.signal }) : args.file;
    if (!selectedFile) {
      emitJson = false;
      process.exitCode = 0;
    } else {
      emitJson = !args.stream && (!fullScreen || args.json);
      renderer = args.stream ? createLineRenderer({ interactive: false, formatError: redactedMessage }) : fullScreen ? createTerminalRenderer({ formatError: redactedMessage }) : args.headless ? createLineRenderer({ interactive: textTerminal, formatError: redactedMessage }) : void 0;
      const httpProvider = httpProviderFromEnvironment();
      if (httpProvider) for (const secret of collectHttpProviderSecrets(httpProvider, process.env)) redactionSecrets.add(secret);
      const profileProvider = httpProvider ? void 0 : await localProvider(localStore);
      const provider = httpProvider ?? profileProvider;
      if (profileProvider?.apiKey) redactionSecrets.add(profileProvider.apiKey);
      const interactiveTrust = fullScreen ? createPersistentTrustProvider(localStore, (request) => promptTerminalTrust(request, { signal: cliAbortController.signal })) : void 0;
      const permissions = createNativePermissionAdapter(fullScreen ? {
        selectPath: (request, signal) => selectTerminalPermissionPath(request, signal)
      } : {});
      runtime = createRuntimeKernel({
        provider,
        trustedKeys: { ...await localStore.trustedKeys(), ...trustedKeysFromEnvironment() },
        grants: grantsFromEnvironment(),
        permissions,
        allowUnsignedPlugins: args.allowUnsignedPlugins,
        trustProvider: interactiveTrust
      });
      rendererManaged = true;
      if (fullScreen && !args.json) {
        const app = await runtime.openAiApp(selectedFile);
        try {
          const gatewayAccepted = await confirmTerminalGateway(app.info, selectedFile, { signal: cliAbortController.signal, preflight: () => app.preflight() });
          if (!gatewayAccepted) {
            emitJson = false;
            process.exitCode = 0;
          } else {
            const interactive = Boolean(app.interaction?.conversation?.multiTurn || app.interaction?.conversation?.history || app.interaction?.knowledge);
            if (interactive) await runTerminalApp(app, {
              initialInput: args.input,
              variables: args.variables,
              signal: cliAbortController.signal,
              formatError: redactedMessage,
              openSettings: () => runTerminalSettings(localStore, { signal: cliAbortController.signal })
            });
            else await app.run({ input: args.input, variables: args.variables, signal: cliAbortController.signal, renderer });
          }
        } finally {
          await app.dispose();
        }
      } else if (args.stream) {
        const stream = await runtime.streamAiFile(selectedFile, {
          mode: "text",
          input: args.input,
          variables: args.variables,
          signal: cliAbortController.signal,
          renderer
        });
        let last = "";
        for await (const chunk of stream) {
          last = chunk;
          process.stdout.write(chunk);
        }
        await stream.result;
        if (!last.endsWith("\n")) process.stdout.write("\n");
      } else {
        const result = await runtime.runAiFile(selectedFile, { input: args.input, variables: args.variables, signal: cliAbortController.signal, renderer });
        if (emitJson) writeJson(result);
      }
    }
  }
} catch (error) {
  if (renderer && !rendererManaged) {
    await Promise.resolve(renderer.fail?.(error)).catch(() => void 0);
    await Promise.resolve(renderer.dispose?.()).catch(() => void 0);
  }
  const failure = classify(error, cliInterrupted);
  const value = error;
  if (emitJson) {
    writeJson({
      ok: false,
      error: {
        code: failure.code,
        message: redactedMessage(error),
        ...value?.phase ? { phase: value.phase } : {},
        ...Array.isArray(value?.issues) ? { issues: value.issues } : {}
      }
    });
  } else if (emitStream) process.stderr.write(`agcomm: ${failure.code}: ${redactedMessage(error)}
`);
  process.exitCode = failure.exitCode;
} finally {
  await runtime?.dispose();
  await gateway?.dispose();
  disposeCliSignals();
}
