type EmbeddingProvider = {
    model: string;
    embed(input: {
        texts: string[];
        signal: AbortSignal;
    }): Promise<readonly (readonly number[])[]>;
};
export declare function chunkKnowledgeSegments(segments: readonly string[], config: {
    chunkSize: number;
    chunkOverlap: number;
}): string[];
export declare function embedKnowledgeChunks(chunks: readonly string[], provider: EmbeddingProvider | undefined, signal: AbortSignal, onProgress?: (completed: number, total: number) => void): Promise<{
    vectors: number[][];
    dimensions: number;
}>;
export {};
