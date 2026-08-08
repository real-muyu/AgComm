import type { EmbeddingProvider, LocalAppStore } from "../app-storage.ts";
import type { RuntimeProject } from "./ProjectExecutor.ts";
import { createRuntimeSessionHandle, type SessionExecution } from "./session/RuntimeSessionHandle.ts";
import { SessionKnowledgeResolver } from "./session/SessionKnowledgeResolver.ts";
import { SessionRepository } from "./session/SessionRepository.ts";

export type RuntimeSessionFactoryOptions = {
  project: RuntimeProject;
  store: LocalAppStore;
  persistent: boolean;
  embeddingProvider?: EmbeddingProvider;
  execute: SessionExecution;
};

export function createRuntimeSessionFactory(options: RuntimeSessionFactoryOptions) {
  const repository = new SessionRepository(options.store, options.persistent);
  const knowledge = new SessionKnowledgeResolver(options.project, options.store, options.embeddingProvider);
  const handle = (initial: Awaited<ReturnType<SessionRepository["create"]>>) => createRuntimeSessionHandle({
    initial,
    repository,
    knowledge,
    project: options.project,
    packageHash: options.store.appId,
    execute: options.execute,
  });

  return {
    assertAppOpen: () => repository.assertOpen(),
    read: (id: string) => repository.read(id),
    create: async (title?: string) => handle(await repository.create(title)),
    open: async (id: string) => handle(await repository.read(id)),
    list: () => repository.list(),
    delete: (id: string) => repository.delete(id),
    disposeApp: () => repository.dispose(),
  };
}
