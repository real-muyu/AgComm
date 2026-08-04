import type {
  AiRunResult,
  AiRunStream,
  AiStreamEvent,
  AiSessionHandle,
  KnowledgeDocument,
  KnowledgeImportOptions,
  KnowledgeScope,
  RunAiOptions,
  RuntimeOptions,
  SessionSummary,
  StreamRunOptions,
} from "@agcomm/ai-runtime";
import type { GatewayInstallOptions, RuntimeGatewayClient } from "@agcomm/gateway";
import { buildAi } from "./build.ts";
import type { AppDefinition } from "./model.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RunAppOptions = {
  runtime?: RuntimeOptions;
  run?: RunAiOptions;
};

export type StreamAppOptions = {
  runtime?: RuntimeOptions;
  run?: StreamRunOptions;
};

export type AppRunner = {
  readonly packageHash: string;
  readonly info: import("@agcomm/ai-runtime").AiAppInfo;
  preflight(): Promise<void>;
  run(options?: RunAiOptions): Promise<AiRunResult>;
  stream(options: StreamRunOptions & { mode: "text" }): AiRunStream<string>;
  stream(options: StreamRunOptions & { mode: "events" }): AiRunStream<AiStreamEvent>;
  stream(options?: StreamRunOptions): AiRunStream<string | AiStreamEvent>;
  listSessions(): Promise<SessionSummary[]>;
  createSession(options?: { title?: string }): Promise<AiSessionHandle>;
  openSession(id: string): Promise<AiSessionHandle>;
  deleteSession(id: string): Promise<void>;
  listKnowledge(scope: KnowledgeScope): Promise<KnowledgeDocument[]>;
  importKnowledge(paths: readonly string[], options: KnowledgeImportOptions): Promise<KnowledgeDocument[]>;
  removeKnowledge(ids: readonly string[], scope: KnowledgeScope): Promise<void>;
  reindexKnowledge(ids: readonly string[] | undefined, options: KnowledgeImportOptions): Promise<KnowledgeDocument[]>;
  dispose(): Promise<void>;
};

async function loadRuntime() {
  try { return await import("@agcomm/ai-runtime"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
    return import(new URL("../../ai-runtime/dist/index.js", import.meta.url).href) as Promise<typeof import("@agcomm/ai-runtime")>;
  }
}

async function loadGateway() {
  try { return await import("@agcomm/gateway"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
    return import(new URL("../../gateway/dist/index.js", import.meta.url).href) as Promise<typeof import("@agcomm/gateway")>;
  }
}

export async function createAppRunner(app: AppDefinition, runtimeOptions: RuntimeOptions = {}): Promise<AppRunner> {
  const bytes = await buildAi(app);
  const { createRuntime } = await loadRuntime();
  const runtime = createRuntime(runtimeOptions);
  const opened = await runtime.openAiApp(bytes);
  let disposed = false;
  const assertOpen = () => {
    if (disposed) throw new Error("AppRunner has been disposed");
  };
  return {
    packageHash: opened.packageHash,
    info: opened.info,
    async preflight() { assertOpen(); return opened.preflight(); },
    async run(options = {}) {
      assertOpen();
      return opened.run(options);
    },
    stream(options = {}) {
      assertOpen();
      return opened.stream(options);
    },
    async listSessions() { assertOpen(); return opened.listSessions(); },
    async createSession(options) { assertOpen(); return opened.createSession(options); },
    async openSession(id) { assertOpen(); return opened.openSession(id); },
    async deleteSession(id) { assertOpen(); return opened.deleteSession(id); },
    async listKnowledge(scope) { assertOpen(); return opened.listKnowledge(scope); },
    async importKnowledge(paths, options) { assertOpen(); return opened.importKnowledge(paths, options); },
    async removeKnowledge(ids, scope) { assertOpen(); return opened.removeKnowledge(ids, scope); },
    async reindexKnowledge(ids, options) { assertOpen(); return opened.reindexKnowledge(ids, options); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await opened.dispose();
      await runtime.dispose();
    },
  } as AppRunner;
}

export async function runApp(app: AppDefinition, options: RunAppOptions = {}): Promise<AiRunResult> {
  const runner = await createAppRunner(app, options.runtime);
  try { return await runner.run(options.run); }
  finally { await runner.dispose(); }
}

export function streamApp(app: AppDefinition, options: StreamAppOptions & { run: StreamRunOptions & { mode: "text" } }): Promise<AiRunStream<string>>;
export function streamApp(app: AppDefinition, options: StreamAppOptions & { run: StreamRunOptions & { mode: "events" } }): Promise<AiRunStream<AiStreamEvent>>;
export function streamApp(app: AppDefinition, options?: StreamAppOptions): Promise<AiRunStream<string | AiStreamEvent>>;
export async function streamApp(app: AppDefinition, options: StreamAppOptions = {}): Promise<AiRunStream<string | AiStreamEvent>> {
  const runner = await createAppRunner(app, options.runtime);
  try {
    const stream = runner.stream(options.run);
    void stream.result.then(() => runner.dispose(), () => runner.dispose());
    return stream;
  } catch (error) {
    await runner.dispose();
    throw error;
  }
}

export type InstallBackgroundAppOptions = {
  gateway?: RuntimeGatewayClient;
  gatewayRoot?: string;
  install?: GatewayInstallOptions;
};

export async function installBackgroundApp(app: AppDefinition, options: InstallBackgroundAppOptions = {}) {
  const bytes = await buildAi(app);
  const gatewayModule = await loadGateway();
  const gateway = options.gateway ?? await gatewayModule.connectRuntimeGateway({ root: options.gatewayRoot });
  const directory = await mkdtemp(join(tmpdir(), "agcomm-sdk-gateway-"));
  const path = join(directory, "app.ai");
  try { await writeFile(path, bytes, { mode: 0o600 }); return await gateway.install(path, options.install); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

export type {
  AiAppHandle,
  AiAppInfo,
  AiRuntime,
  AiRunResult,
  AiRunStream,
  AiStreamEvent,
  AiStreamMode,
  AiSessionHandle,
  ConversationMessage,
  EmbeddingProvider,
  KnowledgeDocument,
  KnowledgeDocumentParser,
  KnowledgeImportOptions,
  KnowledgeMatch,
  KnowledgeProgress,
  KnowledgeScope,
  RunAiOptions,
  StreamRunOptions,
  RuntimeOptions,
  RuntimeEvent,
  RuntimeTrustDecision,
  RuntimeTrustProvider,
  RuntimeTrustRequest,
  SessionRecord,
  SessionSummary,
} from "@agcomm/ai-runtime";

export type {
  GatewayAppSummary,
  GatewayInstallOptions,
  GatewayRunRecord,
  GatewayRunStream,
  GatewayRunTicket,
  GatewayStartRunOptions,
  GatewayStreamFrame,
  RuntimeGatewayClient,
} from "@agcomm/gateway";
