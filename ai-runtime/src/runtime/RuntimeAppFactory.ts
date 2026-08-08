import { BACKGROUND_RUN, type BackgroundRunServices, type BackgroundRunnableApp } from "../background-context.ts";
import { AiRuntimeError } from "../errors.ts";
import type { EmbeddingProvider } from "../app-storage.ts";
import type { AiAppHandle, RunAiOptions, RuntimeOptions, StreamRunOptions } from "../runtime-types.ts";
import { createRuntimeAppInfo } from "./RuntimeAppInfoFactory.ts";
import { loadRuntimeApp } from "./RuntimeAppLoader.ts";
import { RuntimeKnowledgeFacade } from "./RuntimeKnowledgeFacade.ts";
import { createRuntimeSessionFactory } from "./RuntimeSessionFactory.ts";
import type { RuntimeAppExecutionPort } from "./contracts/RuntimeAppPort.ts";

export type RuntimeAppFactoryOptions = RuntimeAppExecutionPort & {
  runtimeOptions: RuntimeOptions;
  embeddingProvider?: EmbeddingProvider;
  activeApps: Set<AiAppHandle>;
};

export function createRuntimeAppFactory(options: RuntimeAppFactoryOptions) {
  return async function openAiApp(pathOrBytes: string | Uint8Array | ArrayBuffer): Promise<AiAppHandle> {
    const { parsed, project, store, persistentHistory } = await loadRuntimeApp(pathOrBytes, options.runtimeOptions);
    let disposed = false;
    const assertOpen = () => { if (disposed) throw new AiRuntimeError("APP_DISPOSED", "AI app handle has been disposed"); };
    const sessions = createRuntimeSessionFactory({
      project,
      store,
      persistent: persistentHistory,
      embeddingProvider: options.embeddingProvider,
      execute: (runOptions, context) => options.executeProject(project, runOptions, context),
    });
    const knowledge = new RuntimeKnowledgeFacade(project, store, sessions, options.embeddingProvider, assertOpen);
    const info = createRuntimeAppInfo(project, parsed.formatVersion, store.appId);
    const app = {
      id: store.appId,
      name: project.name,
      packageHash: store.appId,
      info,
      interaction: project.interaction,
      background: project.background,
      async preflight() { assertOpen(); await options.preflightProject(project, store.appId); },
      async run(runOptions = {}) { assertOpen(); return options.executeProject(project, runOptions, { packageHash: store.appId }); },
      stream(streamOptions: StreamRunOptions = {}) { assertOpen(); return options.streamProject(project, streamOptions, { packageHash: store.appId }); },
      async [BACKGROUND_RUN](runOptions: RunAiOptions, services: BackgroundRunServices) {
        assertOpen();
        return options.executeProject(project, runOptions, {
          packageHash: store.appId,
          history: services.history?.map((message) => ({ ...message, createdAt: "" })),
          background: services,
        });
      },
      async listSessions() { assertOpen(); return sessions.list(); },
      async createSession(createOptions = {}) { assertOpen(); return sessions.create(createOptions.title); },
      async openSession(id) { assertOpen(); return sessions.open(id); },
      async deleteSession(id) { assertOpen(); return sessions.delete(id); },
      listKnowledge: (scope) => knowledge.list(scope),
      importKnowledge: (paths, importOptions) => knowledge.import(paths, importOptions),
      removeKnowledge: (ids, scope) => knowledge.remove(ids, scope),
      reindexKnowledge: (ids, importOptions) => knowledge.reindex(ids, importOptions),
      async dispose() {
        if (disposed) return;
        disposed = true;
        sessions.disposeApp();
        options.activeApps.delete(app);
      },
    } as AiAppHandle & BackgroundRunnableApp;
    options.activeApps.add(app);
    return app;
  };
}
