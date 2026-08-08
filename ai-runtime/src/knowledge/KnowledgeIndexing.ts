import { AiRuntimeError } from "../errors.ts";

type EmbeddingProvider = { model: string; embed(input: { texts: string[]; signal: AbortSignal }): Promise<readonly (readonly number[])[]> };

export function chunkKnowledgeSegments(segments: readonly string[], config: { chunkSize: number; chunkOverlap: number }) {
  const step = config.chunkSize - config.chunkOverlap;
  return segments.flatMap((segment) => {
    const text = String(segment);
    const chunks: string[] = [];
    for (let offset = 0; offset < text.length; offset += step) chunks.push(text.slice(offset, offset + config.chunkSize));
    return chunks;
  });
}

export async function embedKnowledgeChunks(chunks: readonly string[], provider: EmbeddingProvider | undefined, signal: AbortSignal, onProgress?: (completed: number, total: number) => void) {
  if (!provider) throw new AiRuntimeError("EMBEDDING_PROVIDER_REQUIRED", "An embedding provider is required to index knowledge files");
  const vectors: number[][] = [];
  for (let offset = 0; offset < chunks.length; offset += 32) {
    vectors.push(...(await provider.embed({ texts: [...chunks.slice(offset, offset + 32)], signal })).map((vector) => [...vector]));
    onProgress?.(Math.min(chunks.length, offset + 32), chunks.length);
  }
  const dimensions = vectors[0]?.length ?? 0;
  if (!dimensions || vectors.some((vector) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))) throw new AiRuntimeError("KNOWLEDGE_INDEX_FAILED", "Embedding provider returned invalid vectors");
  return { vectors, dimensions };
}
