import { createHash, randomUUID } from "node:crypto";
import {
  copyFile, mkdir, readFile, readdir, rename, rm, writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { AiRuntimeError } from "./errors.ts";
import { importKnowledgeSources } from "./knowledge/KnowledgeSourceImporter.ts";
import { withLocalFileLock } from "./storage/LocalFileLock.ts";
import { enforcePrivateMode } from "./storage/FilePermissions.ts";
import type { EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeMatch, KnowledgeProgress, KnowledgeScope, SessionRecord, SessionSummary } from "./storage-contracts.ts";
export type { ConversationMessage, EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeMatch, KnowledgeProgress, KnowledgeScope, SessionRecord, SessionSummary, SessionTurn } from "./storage-contracts.ts";

type IndexChunk = {
  id: string;
  sourceId: string;
  sourceName: string;
  text: string;
  vectorOffset: number;
  vectorLength: number;
};

type IndexMetadata = { version: 1; model: string; dimensions: number; chunks: IndexChunk[] };

function safeSessionId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new AiRuntimeError("SESSION_ID_INVALID", `Invalid session id: ${value}`);
  return value;
}

function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function atomicWrite(path: string, value: string | Uint8Array) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new AiRuntimeError("LOCAL_DATA_CORRUPT", `Local runtime data is invalid: ${path}`, { cause: error });
  }
}

function defaultDataRoot() {
  return join(homedir(), ".agcomm", "runtime", "apps");
}

function scopeKey(scope: KnowledgeScope) {
  return scope.type === "app" ? "app" : `session-${safeSessionId(scope.sessionId)}`;
}

function cosine(left: readonly number[], right: Float32Array, offset: number, length: number) {
  if (left.length !== length) return Number.NEGATIVE_INFINITY;
  let dot = 0; let a = 0; let b = 0;
  for (let index = 0; index < length; index++) {
    const l = left[index]; const r = right[offset + index];
    dot += l * r; a += l * l; b += r * r;
  }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

function textParser(): KnowledgeDocumentParser {
  const extensions = [".txt", ".md", ".json", ".csv"];
  return {
    id: "builtin-text",
    version: "1",
    extensions,
    async parse({ bytes }) {
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch (error) { throw new AiRuntimeError("KNOWLEDGE_INVALID_UTF8", "Knowledge source must be valid UTF-8", { cause: error }); }
    },
  };
}

export class LocalAppStore {
  readonly appId: string;
  readonly root: string;
  private readonly parsers: KnowledgeDocumentParser[];

  constructor(packageBytes: Uint8Array, options: { dataDir?: string; parsers?: readonly KnowledgeDocumentParser[] } = {}) {
    this.appId = hashBytes(packageBytes);
    this.root = join(resolve(options.dataDir ?? defaultDataRoot()), this.appId);
    this.parsers = [textParser(), ...(options.parsers ?? [])];
  }

  async initialize() {
    await mkdir(join(this.root, "sessions"), { recursive: true, mode: 0o700 });
    await mkdir(join(this.root, "knowledge"), { recursive: true, mode: 0o700 });
    await enforcePrivateMode(this.root, 0o700, "APP_STORAGE_PERMISSIONS");
    await atomicWrite(join(this.root, "app.json"), JSON.stringify({ version: 1, appId: this.appId }, null, 2));
    await this.scanKnowledge();
  }

  private async scanKnowledge() {
    const root = join(this.root, "knowledge");
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const directory = join(root, entry.name);
      const documents = await readJson<KnowledgeDocument[]>(join(directory, "sources.json"), []);
      if (!documents.length) continue;
      try { await this.readIndex(directory); }
      catch (error) {
        const updated = documents.map((document) => ({ ...document, status: "failed" as const, error: `Index requires rebuilding: ${error instanceof Error ? error.message : String(error)}`, updatedAt: new Date().toISOString() }));
        await atomicWrite(join(directory, "sources.json"), JSON.stringify(updated, null, 2));
        await rm(join(directory, "index.json"), { force: true });
        await rm(join(directory, "vectors.f32"), { force: true });
      }
    }
  }

  private sessionPath(id: string) { return join(this.root, "sessions", `${safeSessionId(id)}.json`); }

  async listSessions(): Promise<SessionSummary[]> {
    const names = await readdir(join(this.root, "sessions"));
    const sessions: SessionSummary[] = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      let session: SessionRecord | undefined;
      try { session = await readJson<SessionRecord | undefined>(join(this.root, "sessions", name), undefined); }
      catch {
        await rename(join(this.root, "sessions", name), join(this.root, "sessions", `${name}.corrupt-${Date.now()}`));
        continue;
      }
      if (session?.version !== 1) continue;
      sessions.push({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length });
    }
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createSession(title = "新会话"): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const session: SessionRecord = { version: 1, id: randomUUID(), title: title.trim().slice(0, 120) || "新会话", createdAt: now, updatedAt: now, messages: [], turns: [] };
    await this.writeSession(session);
    return session;
  }

  async readSession(id: string) {
    const session = await readJson<SessionRecord | undefined>(this.sessionPath(id), undefined);
    if (!session) throw new AiRuntimeError("SESSION_NOT_FOUND", `Session not found: ${id}`);
    return session;
  }

  async writeSession(session: SessionRecord) {
    await withLocalFileLock(this.root, () => atomicWrite(this.sessionPath(session.id), JSON.stringify(session, null, 2)));
  }

  async renameSession(id: string, title: string) {
    const session = await this.readSession(id);
    session.title = title.trim().slice(0, 120) || session.title;
    session.updatedAt = new Date().toISOString();
    await this.writeSession(session);
    return session;
  }

  async deleteSession(id: string) {
    await withLocalFileLock(this.root, async () => {
      await rm(this.sessionPath(id), { force: true });
      await rm(join(this.root, "knowledge", `session-${safeSessionId(id)}`), { recursive: true, force: true });
    });
  }

  private async knowledgeDirectory(scope: KnowledgeScope) {
    const directory = join(this.root, "knowledge", scopeKey(scope));
    await mkdir(join(directory, "sources"), { recursive: true, mode: 0o700 });
    return directory;
  }

  private async documents(scope: KnowledgeScope) {
    const directory = await this.knowledgeDirectory(scope);
    return { directory, values: await readJson<KnowledgeDocument[]>(join(directory, "sources.json"), []) };
  }

  async listKnowledge(scope: KnowledgeScope) { return (await this.documents(scope)).values; }

  private async readIndex(directory: string) {
    const metadata = await readJson<IndexMetadata>(join(directory, "index.json"), { version: 1, model: "", dimensions: 0, chunks: [] });
    let vectors = new Float32Array();
    try {
      const raw = await readFile(join(directory, "vectors.f32"));
      vectors = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const expected = metadata.chunks.reduce((maximum, chunk) => Math.max(maximum, chunk.vectorOffset + chunk.vectorLength), 0);
    if (expected !== vectors.length) throw new AiRuntimeError("KNOWLEDGE_INDEX_CORRUPT", "Knowledge vector index is inconsistent");
    return { metadata, vectors };
  }

  private async writeIndex(directory: string, metadata: IndexMetadata, vectors: Float32Array) {
    await atomicWrite(join(directory, "vectors.f32"), new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength));
    await atomicWrite(join(directory, "index.json"), JSON.stringify(metadata));
  }

  async importKnowledge(
    paths: readonly string[],
    scope: KnowledgeScope,
    provider: EmbeddingProvider | undefined,
    config: { chunkSize: number; chunkOverlap: number },
    signal: AbortSignal,
    onProgress?: (progress: KnowledgeProgress) => void,
  ) {
    const { directory, values } = await this.documents(scope);
    return importKnowledgeSources({ directory, values, parsers: this.parsers, readIndex: () => this.readIndex(directory), writeIndex: (metadata, vectors) => this.writeIndex(directory, metadata, vectors), saveDocuments: () => atomicWrite(join(directory, "sources.json"), JSON.stringify(values, null, 2)) }, paths, provider, config, signal, onProgress);
  }

  async removeKnowledge(ids: readonly string[], scope: KnowledgeScope) {
    const { directory, values } = await this.documents(scope);
    const removeIds = new Set(ids);
    const current = await this.readIndex(directory);
    const kept = current.metadata.chunks.filter((chunk) => !removeIds.has(chunk.sourceId));
    const vectors = new Float32Array(kept.reduce((sum, chunk) => sum + chunk.vectorLength, 0));
    let offset = 0;
    const chunks = kept.map((chunk) => {
      vectors.set(current.vectors.subarray(chunk.vectorOffset, chunk.vectorOffset + chunk.vectorLength), offset);
      const next = { ...chunk, vectorOffset: offset };
      offset += chunk.vectorLength;
      return next;
    });
    await this.writeIndex(directory, { ...current.metadata, chunks }, vectors);
    for (const document of values.filter((item) => removeIds.has(item.id))) {
      const files = await readdir(join(directory, "sources"));
      for (const name of files.filter((item) => item.startsWith(`${document.id}.`))) await rm(join(directory, "sources", name), { force: true });
    }
    await atomicWrite(join(directory, "sources.json"), JSON.stringify(values.filter((item) => !removeIds.has(item.id)), null, 2));
  }

  async reindexKnowledge(ids: readonly string[] | undefined, scope: KnowledgeScope, provider: EmbeddingProvider | undefined, config: { chunkSize: number; chunkOverlap: number }, signal: AbortSignal, onProgress?: (progress: KnowledgeProgress) => void) {
    const { directory, values } = await this.documents(scope);
    const selected = values.filter((document) => !ids?.length || ids.includes(document.id));
    const temporaryDirectory = join(directory, `.reindex-${randomUUID()}`);
    await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    const paths: string[] = [];
    try {
      const sourceFiles = await readdir(join(directory, "sources"));
      for (const document of selected) {
        const sourceName = sourceFiles.find((name) => name.startsWith(`${document.id}.`));
        if (!sourceName) continue;
        const path = join(temporaryDirectory, `${document.id}-${document.name.replace(/[^A-Za-z0-9._-]/g, "_") || sourceName}`);
        await copyFile(join(directory, "sources", sourceName), path);
        paths.push(path);
      }
      await this.removeKnowledge(selected.map((item) => item.id), scope);
      return await this.importKnowledge(paths, scope, provider, config, signal, onProgress);
    } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
  }

  async searchKnowledge(query: string, scopes: readonly KnowledgeScope[], provider: EmbeddingProvider | undefined, topK: number, signal: AbortSignal): Promise<KnowledgeMatch[]> {
    if (!provider) throw new AiRuntimeError("EMBEDDING_PROVIDER_REQUIRED", "An embedding provider is required to query knowledge files");
    const [queryVector] = await provider.embed({ texts: [query], signal });
    if (!queryVector?.length) throw new AiRuntimeError("KNOWLEDGE_INDEX_FAILED", "Embedding provider returned no query vector");
    const matches: KnowledgeMatch[] = [];
    for (const scope of scopes) {
      const directory = await this.knowledgeDirectory(scope);
      const { metadata, vectors } = await this.readIndex(directory);
      if (!metadata.chunks.length) continue;
      if (metadata.model !== provider.model || metadata.dimensions !== queryVector.length) throw new AiRuntimeError("KNOWLEDGE_INDEX_STALE", "Knowledge index was created with a different embedding model");
      for (const chunk of metadata.chunks) matches.push({
        sourceId: chunk.sourceId, sourceName: chunk.sourceName, chunkId: chunk.id, text: chunk.text,
        score: cosine(queryVector, vectors, chunk.vectorOffset, chunk.vectorLength), scope,
      });
    }
    return matches.sort((left, right) => right.score - left.score).slice(0, topK);
  }
}
