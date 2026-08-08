import type { EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeProgress } from "../storage-contracts.ts";
type IndexChunk = {
    id: string;
    sourceId: string;
    sourceName: string;
    text: string;
    vectorOffset: number;
    vectorLength: number;
};
type IndexMetadata = {
    version: 1;
    model: string;
    dimensions: number;
    chunks: IndexChunk[];
};
type Index = {
    metadata: IndexMetadata;
    vectors: Float32Array;
};
export type KnowledgeImportPort = {
    directory: string;
    values: KnowledgeDocument[];
    parsers: readonly KnowledgeDocumentParser[];
    readIndex(): Promise<Index>;
    writeIndex(metadata: IndexMetadata, vectors: Float32Array): Promise<void>;
    saveDocuments(): Promise<void>;
};
export declare function importKnowledgeSources(port: KnowledgeImportPort, paths: readonly string[], provider: EmbeddingProvider | undefined, config: {
    chunkSize: number;
    chunkOverlap: number;
}, signal: AbortSignal, onProgress?: (progress: KnowledgeProgress) => void): Promise<KnowledgeDocument[]>;
export {};
