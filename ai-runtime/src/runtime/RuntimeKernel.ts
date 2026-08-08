import { AiRuntimeError } from "../errors.ts";
import { createHttpModelProvider } from "../http-provider.ts";
import { createLineRenderer } from "../line-renderer.ts";
import { createTerminalRenderer } from "../terminal-renderer.ts";
import { runTerminalApp, type TerminalAppOptions } from "../terminal-app.ts";
import { createOpenAiEmbeddingProvider } from "../embedding-provider.ts";
import { RuntimeLifecycle } from "./RuntimeLifecycle.ts";
import { createProjectExecutor } from "./ProjectExecutor.ts";
import { createRuntimeStreamFactory } from "./RuntimeStreamFactory.ts";
import { createRuntimePreflight } from "./RuntimePreflight.ts";
import type { PluginManager } from "./PluginManager.ts";
import { createRuntimeProviders } from "./RuntimeProviderFactory.ts";
import { createRuntimeAppFactory } from "./RuntimeAppFactory.ts";
import type {
  AiAppHandle,
  AiRunResult,
  AiRunStream,
  AiRuntime,
  AiStreamEvent,
  RunAiOptions,
  RuntimeOptions,
  StreamRunOptions,
} from "../runtime-types.ts";

export type {
  AiAppHandle,
  AiAppInfo,
  AiRunResult,
  AiRunStream,
  AiRuntime,
  AiSessionHandle,
  AiStreamEvent,
  AiStreamMode,
  KnowledgeImportOptions,
  ModelInvocationContext,
  RunAiOptions,
  RuntimeBundleKind,
  RuntimeEvent,
  RuntimeOptions,
  RuntimeTrustDecision,
  RuntimeTrustProvider,
  RuntimeTrustRequest,
  SessionRunOptions,
  StreamRunOptions,
} from "../runtime-types.ts";

export { AiRuntimeError, createHttpModelProvider, createLineRenderer, createOpenAiEmbeddingProvider, createTerminalRenderer, runTerminalApp };
export type { TerminalAppOptions };
export type { HttpModelProviderConfig } from "../http-provider.ts";
export type { ModelEvent, ModelProvider, ModelReply, ProviderConfig } from "../model-provider.ts";
export type { PermissionAdapter, RuntimePermission } from "../plugin-sandbox.ts";
export { createNativePermissionAdapter } from "../host-permissions.ts";
export type { RuntimePathRequest, RuntimePathSelector } from "../host-permissions.ts";
export { createPersistentTrustProvider, createSystemCredentialStore, LocalRuntimeConfigStore } from "../local-config.ts";
export type { ProviderProfile, RuntimeCredentialStore, RuntimeTrustRecord } from "../local-config.ts";
export {
  confirmTerminalGateway, promptTerminalTrust, runTerminalGatewayManager, runTerminalLauncher, runTerminalSettings,
  selectTerminalPermissionPath,
} from "../terminal-launcher.ts";
export type { GatewayTerminalIo } from "../terminal-launcher.ts";
export type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
export type {
  RuntimeInputComponent, RuntimeInputField, RuntimeInputLayout, RuntimeInputRequest, RuntimeInputSize,
  RuntimeRenderer, RuntimeRendererResult, RuntimeRendererStart,
} from "../renderer.ts";
export type { TerminalInput, TerminalOutput, TerminalRendererOptions } from "../terminal-renderer.ts";
export type { LineRendererInput, LineRendererOptions, LineRendererOutput } from "../line-renderer.ts";
export type {
  ConversationMessage, EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeMatch, KnowledgeProgress,
  KnowledgeScope, SessionRecord, SessionSummary,
} from "../app-storage.ts";
export type { OpenAiEmbeddingProviderOptions } from "../embedding-provider.ts";

export function createRuntimeKernel(options: RuntimeOptions = {}): AiRuntime {
  const { config, provider, embeddingProvider, providerInjected } = createRuntimeProviders(options);
  const lifecycle = new RuntimeLifecycle();
  const activeControllers = lifecycle.controllers;
  const activeManagers = new Set<PluginManager>();
  const activeApps = new Set<AiAppHandle>();

  const preflightProject = createRuntimePreflight(options, config, providerInjected);

  const executeProject = createProjectExecutor({ options, config, provider, controllers: activeControllers, managers: activeManagers });

  const streamProject = createRuntimeStreamFactory(executeProject);

  const openAiApp = createRuntimeAppFactory({
    runtimeOptions: options,
    embeddingProvider,
    executeProject,
    streamProject,
    preflightProject,
    activeApps,
  });

  return {
    async runAiFile(pathOrBytes: string | Uint8Array | ArrayBuffer, runOptions: RunAiOptions = {}): Promise<AiRunResult> {
      const app = await openAiApp(pathOrBytes);
      try {
        return await app.run(runOptions);
      } finally { await app.dispose(); }
    },
    async streamAiFile(pathOrBytes: string | Uint8Array | ArrayBuffer, streamOptions: StreamRunOptions = {}) {
      const app = await openAiApp(pathOrBytes);
      const stream = app.stream(streamOptions);
      void stream.result.then(() => app.dispose(), () => app.dispose());
      return stream;
    },
    openAiApp,
    async dispose() {
      await lifecycle.dispose([
        ...[...activeManagers].map((manager) => () => manager.dispose()),
        ...[...activeApps].map((app) => () => app.dispose()),
      ]);
      activeManagers.clear();
      activeApps.clear();
    },
  } as AiRuntime;
}

export async function runAiFile(
  pathOrBytes: string | Uint8Array | ArrayBuffer,
  options: RunAiOptions & RuntimeOptions = {},
) {
  const { input, variables, signal, onModelEvent, onRuntimeEvent, onStreamEvent, onOutputDelta, mode, renderer, ...runtimeOptions } = options;
  const runtime = createRuntimeKernel(runtimeOptions);
  try { return await runtime.runAiFile(pathOrBytes, { input, variables, signal, onModelEvent, onRuntimeEvent, onStreamEvent, onOutputDelta, mode, renderer }); }
  finally { await runtime.dispose(); }
}

export function streamAiFile(
  pathOrBytes: string | Uint8Array | ArrayBuffer,
  options: StreamRunOptions & RuntimeOptions & { mode: "text" },
): Promise<AiRunStream<string>>;
export function streamAiFile(
  pathOrBytes: string | Uint8Array | ArrayBuffer,
  options: StreamRunOptions & RuntimeOptions & { mode: "events" },
): Promise<AiRunStream<AiStreamEvent>>;
export function streamAiFile(
  pathOrBytes: string | Uint8Array | ArrayBuffer,
  options?: StreamRunOptions & RuntimeOptions,
): Promise<AiRunStream<string | AiStreamEvent>>;
export async function streamAiFile(
  pathOrBytes: string | Uint8Array | ArrayBuffer,
  options: StreamRunOptions & RuntimeOptions = {},
): Promise<AiRunStream<string | AiStreamEvent>> {
  const { mode, input, variables, signal, onModelEvent, onRuntimeEvent, onStreamEvent, onOutputDelta, renderer, ...runtimeOptions } = options;
  const runtime = createRuntimeKernel(runtimeOptions);
  try {
    const stream = await runtime.streamAiFile(pathOrBytes, {
      mode, input, variables, signal, onModelEvent, onRuntimeEvent, onStreamEvent, onOutputDelta, renderer,
    });
    void stream.result.then(() => runtime.dispose(), () => runtime.dispose());
    return stream;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
