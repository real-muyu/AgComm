export type ConversationMessage = {
    role: "user" | "assistant";
    content: string;
    createdAt: string;
};
export type SessionTurn = {
    id: string;
    input: string;
    status: "completed" | "failed";
    output?: unknown;
    error?: string;
    elapsedMs?: number;
    createdAt: string;
};
export type SessionRecord = {
    version: 1;
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: ConversationMessage[];
    turns: SessionTurn[];
};
export type SessionSummary = Pick<SessionRecord, "id" | "title" | "createdAt" | "updatedAt"> & {
    messageCount: number;
};
export type KnowledgeScope = {
    type: "app";
} | {
    type: "session";
    sessionId: string;
};
export type KnowledgeDocumentParser = {
    id: string;
    version: string;
    extensions: readonly string[];
    parse(input: {
        path: string;
        bytes: Uint8Array;
        signal: AbortSignal;
    }): Promise<string | readonly string[]>;
};
export type EmbeddingProvider = {
    model: string;
    embed(input: {
        texts: readonly string[];
        signal: AbortSignal;
    }): Promise<readonly (readonly number[])[]>;
};
export type KnowledgeDocument = {
    id: string;
    name: string;
    sourceHash: string;
    parserId: string;
    parserVersion: string;
    byteLength: number;
    chunkCount: number;
    status: "ready" | "failed";
    error?: string;
    createdAt: string;
    updatedAt: string;
};
export type KnowledgeMatch = {
    sourceId: string;
    sourceName: string;
    chunkId: string;
    text: string;
    score: number;
    scope: KnowledgeScope;
};
export type KnowledgeProgress = {
    phase: "copy" | "parse" | "chunk" | "embed" | "complete" | "failed";
    path: string;
    name: string;
    fileIndex: number;
    fileCount: number;
    completed?: number;
    total?: number;
    message?: string;
};
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
    private parserFor;
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
