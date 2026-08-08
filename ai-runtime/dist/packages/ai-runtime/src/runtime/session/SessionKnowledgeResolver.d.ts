import type { EmbeddingProvider, LocalAppStore } from "../../app-storage.ts";
import type { RuntimeProject } from "../ProjectExecutor.ts";
export declare class SessionKnowledgeResolver {
    private readonly project;
    private readonly store;
    private readonly embeddingProvider?;
    constructor(project: RuntimeProject, store: LocalAppStore, embeddingProvider?: EmbeddingProvider | undefined);
    resolve(input: string, sessionId: string, signal?: AbortSignal): Promise<string>;
    private readyScopes;
    private hasReady;
}
