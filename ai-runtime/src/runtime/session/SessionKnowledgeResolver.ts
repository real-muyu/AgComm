import type { EmbeddingProvider, KnowledgeScope, LocalAppStore } from "../../app-storage.ts";
import type { RuntimeProject } from "../ProjectExecutor.ts";

export class SessionKnowledgeResolver {
  constructor(
    private readonly project: RuntimeProject,
    private readonly store: LocalAppStore,
    private readonly embeddingProvider?: EmbeddingProvider,
  ) {}

  async resolve(input: string, sessionId: string, signal?: AbortSignal): Promise<string> {
    const config = this.project.interaction?.knowledge;
    if (!config) return "";
    const scopes = await this.readyScopes(sessionId, config.scopes ?? ["app"]);
    if (scopes.length === 0) return "";
    const abortSignal = signal ?? new AbortController().signal;
    const matches = await this.store.searchKnowledge(input, scopes, this.embeddingProvider, config.topK ?? 6, abortSignal);
    return matches.map((match, index) =>
      `[${index + 1}] ${match.sourceName} (${match.scope.type}, ${match.chunkId})\n${match.text}`,
    ).join("\n\n");
  }

  private async readyScopes(sessionId: string, configured: readonly ("app" | "session")[]): Promise<KnowledgeScope[]> {
    const scopes: KnowledgeScope[] = [];
    if (configured.includes("app") && await this.hasReady({ type: "app" })) scopes.push({ type: "app" });
    const sessionScope: KnowledgeScope = { type: "session", sessionId };
    if (configured.includes("session") && await this.hasReady(sessionScope)) scopes.push(sessionScope);
    return scopes;
  }

  private async hasReady(scope: KnowledgeScope): Promise<boolean> {
    return (await this.store.listKnowledge(scope)).some((item) => item.status === "ready");
  }
}
