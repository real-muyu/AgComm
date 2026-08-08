import type { EmbeddingProvider, KnowledgeScope, LocalAppStore } from "../app-storage.ts";
import { AiRuntimeError } from "../errors.ts";
import type { KnowledgeImportOptions } from "../runtime-types.ts";
import type { RuntimeProject } from "./PackageParser.ts";
import { safeText } from "./PluginManager.ts";

type SessionReader = { read(id: string): Promise<unknown> };

export class RuntimeKnowledgeFacade {
  private readonly config: NonNullable<RuntimeProject["interaction"]>["knowledge"];

  constructor(
    project: RuntimeProject,
    private readonly store: LocalAppStore,
    private readonly sessions: SessionReader,
    private readonly embeddingProvider: EmbeddingProvider | undefined,
    private readonly assertOpen: () => void,
  ) {
    this.config = project.interaction?.knowledge;
  }

  private async validateScope(scope: KnowledgeScope) {
    this.assertOpen();
    if (!this.config) throw new AiRuntimeError("KNOWLEDGE_DISABLED", "This .ai app does not declare knowledge support");
    if (!(this.config.scopes ?? ["app"]).includes(scope.type)) throw new AiRuntimeError("KNOWLEDGE_SCOPE_DISABLED", `Knowledge scope is not enabled: ${scope.type}`);
    if (scope.type === "session") { safeText(scope.sessionId, 64); await this.sessions.read(scope.sessionId); }
  }

  async list(scope: KnowledgeScope) {
    await this.validateScope(scope);
    return this.store.listKnowledge(scope);
  }

  async import(paths: readonly string[], options: KnowledgeImportOptions) {
    await this.validateScope(options.scope);
    return this.store.importKnowledge(paths, options.scope, this.embeddingProvider, this.chunking(), options.signal ?? new AbortController().signal, options.onProgress);
  }

  async remove(ids: readonly string[], scope: KnowledgeScope) {
    await this.validateScope(scope);
    await this.store.removeKnowledge(ids, scope);
  }

  async reindex(ids: readonly string[] | undefined, options: KnowledgeImportOptions) {
    await this.validateScope(options.scope);
    return this.store.reindexKnowledge(ids, options.scope, this.embeddingProvider, this.chunking(), options.signal ?? new AbortController().signal, options.onProgress);
  }

  private chunking() {
    return { chunkSize: this.config?.chunkSize ?? 1200, chunkOverlap: this.config?.chunkOverlap ?? 200 };
  }
}
