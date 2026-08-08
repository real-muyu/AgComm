import type { EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeMatch, KnowledgeProgress, KnowledgeScope, SessionRecord, SessionSummary } from "./storage-contracts.ts";
export type { ConversationMessage, EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeMatch, KnowledgeProgress, KnowledgeScope, SessionRecord, SessionSummary, SessionTurn } from "./storage-contracts.ts";
export declare class LocalAppStore {
    readonly appId: string;
    readonly root: string;
    private readonly parsers;
    constructor(packageBytes: Uint8Array, options?: {
        dataDir?: string;
        parsers?: readonly KnowledgeDocumentParser[];
    });
    initialize(): Promise<void>;
    private scanKnowledge;
    private sessionPath;
    listSessions(): Promise<SessionSummary[]>;
    createSession(title?: string): Promise<SessionRecord>;
    readSession(id: string): Promise<SessionRecord>;
    writeSession(session: SessionRecord): Promise<void>;
    renameSession(id: string, title: string): Promise<SessionRecord>;
    deleteSession(id: string): Promise<void>;
    private knowledgeDirectory;
    private documents;
    listKnowledge(scope: KnowledgeScope): Promise<KnowledgeDocument[]>;
    private readIndex;
    private writeIndex;
    importKnowledge(paths: readonly string[], scope: KnowledgeScope, provider: EmbeddingProvider | undefined, config: {
        chunkSize: number;
        chunkOverlap: number;
    }, signal: AbortSignal, onProgress?: (progress: KnowledgeProgress) => void): Promise<KnowledgeDocument[]>;
    removeKnowledge(ids: readonly string[], scope: KnowledgeScope): Promise<void>;
    reindexKnowledge(ids: readonly string[] | undefined, scope: KnowledgeScope, provider: EmbeddingProvider | undefined, config: {
        chunkSize: number;
        chunkOverlap: number;
    }, signal: AbortSignal, onProgress?: (progress: KnowledgeProgress) => void): Promise<KnowledgeDocument[]>;
    searchKnowledge(query: string, scopes: readonly KnowledgeScope[], provider: EmbeddingProvider | undefined, topK: number, signal: AbortSignal): Promise<KnowledgeMatch[]>;
}
