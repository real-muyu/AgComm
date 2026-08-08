import { createHash, randomUUID } from "node:crypto";
import { copyFile, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { AiRuntimeError } from "../errors.ts";
import { chunkKnowledgeSegments, embedKnowledgeChunks } from "./KnowledgeIndexing.ts";
import type { EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeProgress } from "../storage-contracts.ts";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCES = 200;
const MAX_CHUNKS = 20_000;
type IndexChunk = { id: string; sourceId: string; sourceName: string; text: string; vectorOffset: number; vectorLength: number };
type IndexMetadata = { version: 1; model: string; dimensions: number; chunks: IndexChunk[] };
type Index = { metadata: IndexMetadata; vectors: Float32Array };
export type KnowledgeImportPort = {
  directory: string;
  values: KnowledgeDocument[];
  parsers: readonly KnowledgeDocumentParser[];
  readIndex(): Promise<Index>;
  writeIndex(metadata: IndexMetadata, vectors: Float32Array): Promise<void>;
  saveDocuments(): Promise<void>;
};

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function parserFor(parsers: readonly KnowledgeDocumentParser[], path: string) { const extension = extname(path).toLowerCase(); return parsers.find((parser) => parser.extensions.some((item) => item.toLowerCase() === extension)); }

async function inspectSource(requestedPath: string, parsers: readonly KnowledgeDocumentParser[]) {
  let path: string;
  try { path = await realpath(resolve(requestedPath)); } catch (error) { throw new AiRuntimeError("KNOWLEDGE_SOURCE_INVALID", `Knowledge source cannot be opened: ${requestedPath}`, { cause: error }); }
  const info = await stat(path);
  if (!info.isFile()) throw new AiRuntimeError("KNOWLEDGE_SOURCE_INVALID", `Knowledge source is not a file: ${requestedPath}`);
  if (info.size > MAX_SOURCE_BYTES) throw new AiRuntimeError("KNOWLEDGE_SOURCE_TOO_LARGE", `Knowledge source exceeds ${MAX_SOURCE_BYTES} bytes`);
  const parser = parserFor(parsers, path);
  if (!parser) throw new AiRuntimeError("KNOWLEDGE_PARSER_NOT_FOUND", `No knowledge parser is registered for ${extname(path) || "this file"}`);
  const bytes = new Uint8Array(await readFile(path));
  return { path, parser, bytes, sourceHash: hash(bytes) };
}

async function indexSource(port: KnowledgeImportPort, source: Awaited<ReturnType<typeof inspectSource>>, document: KnowledgeDocument, provider: EmbeddingProvider | undefined, config: { chunkSize: number; chunkOverlap: number }, signal: AbortSignal, progress: (phase: KnowledgeProgress["phase"], extra?: Partial<KnowledgeProgress>) => void) {
  progress("parse");
  const parsed = await source.parser.parse({ path: source.path, bytes: source.bytes, signal });
  const chunks = chunkKnowledgeSegments((Array.isArray(parsed) ? parsed : [parsed]).map(String).filter((item) => item.trim()), config);
  progress("chunk", { completed: chunks.length, total: chunks.length });
  if (!provider) throw new AiRuntimeError("EMBEDDING_PROVIDER_REQUIRED", "An embedding provider is required to index knowledge files");
  const current = await port.readIndex();
  if (current.metadata.chunks.length + chunks.length > MAX_CHUNKS) throw new AiRuntimeError("KNOWLEDGE_CHUNK_LIMIT", `Knowledge scope cannot contain more than ${MAX_CHUNKS} chunks`);
  const embedded = await embedKnowledgeChunks(chunks, provider, signal, (completed, total) => progress("embed", { completed, total }));
  if (current.metadata.chunks.length && (current.metadata.model !== provider.model || (current.metadata.dimensions && current.metadata.dimensions !== embedded.dimensions))) throw new AiRuntimeError("KNOWLEDGE_INDEX_STALE", "Embedding model changed; remove or reindex existing knowledge first");
  const vectors = new Float32Array(current.vectors.length + embedded.vectors.length * embedded.dimensions);
  vectors.set(current.vectors);
  const indexChunks = [...current.metadata.chunks];
  let offset = current.vectors.length;
  embedded.vectors.forEach((vector, index) => { vectors.set(vector, offset); indexChunks.push({ id: `${document.id}-${index}`, sourceId: document.id, sourceName: document.name, text: chunks[index], vectorOffset: offset, vectorLength: embedded.dimensions }); offset += embedded.dimensions; });
  await port.writeIndex({ version: 1, model: provider.model, dimensions: embedded.dimensions, chunks: indexChunks }, vectors);
  Object.assign(document, { chunkCount: chunks.length, status: "ready" as const, error: undefined, updatedAt: new Date().toISOString() });
  progress("complete", { completed: chunks.length, total: chunks.length });
}

export async function importKnowledgeSources(port: KnowledgeImportPort, paths: readonly string[], provider: EmbeddingProvider | undefined, config: { chunkSize: number; chunkOverlap: number }, signal: AbortSignal, onProgress?: (progress: KnowledgeProgress) => void) {
  const results: KnowledgeDocument[] = [];
  for (const [fileIndex, requestedPath] of paths.entries()) {
    if (signal.aborted) throw signal.reason;
    const source = await inspectSource(requestedPath, port.parsers);
    const duplicate = port.values.find((item) => item.sourceHash === source.sourceHash && item.status === "ready");
    if (duplicate) { results.push(duplicate); continue; }
    if (port.values.length >= MAX_SOURCES) throw new AiRuntimeError("KNOWLEDGE_SOURCE_LIMIT", `Knowledge scope cannot contain more than ${MAX_SOURCES} sources`);
    const now = new Date().toISOString();
    const document: KnowledgeDocument = { id: randomUUID(), name: basename(source.path), sourceHash: source.sourceHash, parserId: source.parser.id, parserVersion: source.parser.version, byteLength: source.bytes.byteLength, chunkCount: 0, status: "failed", createdAt: now, updatedAt: now };
    port.values.push(document);
    const base = { path: source.path, name: document.name, fileIndex, fileCount: paths.length };
    const progress = (phase: KnowledgeProgress["phase"], extra: Partial<KnowledgeProgress> = {}) => onProgress?.({ phase, ...base, ...extra } as KnowledgeProgress);
    progress("copy");
    await copyFile(source.path, join(port.directory, "sources", `${document.id}${extname(source.path).toLowerCase()}`));
    try { await indexSource(port, source, document, provider, config, signal, progress); }
    catch (error) { document.error = error instanceof Error ? error.message : String(error); progress("failed", { message: document.error }); await port.saveDocuments(); if (error instanceof AiRuntimeError) throw error; throw new AiRuntimeError("KNOWLEDGE_INDEX_FAILED", `Knowledge source could not be indexed: ${document.name}`, { cause: error }); }
    await port.saveDocuments();
    results.push(document);
  }
  return results;
}
