import type { EmbeddingProvider, KnowledgeScope, LocalAppStore } from "../app-storage.ts";
import type { KnowledgeImportOptions } from "../runtime-types.ts";
import type { RuntimeProject } from "./PackageParser.ts";
type SessionReader = {
    read(id: string): Promise<unknown>;
};
export declare class RuntimeKnowledgeFacade {
    private readonly store;
    private readonly sessions;
    private readonly embeddingProvider;
    private readonly assertOpen;
    private readonly config;
    constructor(project: RuntimeProject, store: LocalAppStore, sessions: SessionReader, embeddingProvider: EmbeddingProvider | undefined, assertOpen: () => void);
    private validateScope;
    list(scope: KnowledgeScope): Promise<import("../storage-contracts.ts").KnowledgeDocument[]>;
    import(paths: readonly string[], options: KnowledgeImportOptions): Promise<import("../storage-contracts.ts").KnowledgeDocument[]>;
    remove(ids: readonly string[], scope: KnowledgeScope): Promise<void>;
    reindex(ids: readonly string[] | undefined, options: KnowledgeImportOptions): Promise<import("../storage-contracts.ts").KnowledgeDocument[]>;
    private chunking;
}
export {};
