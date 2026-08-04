import { validateResolvedPublicUrl } from "../../../lib/network-security.ts";
import { AiRuntimeError } from "./errors.ts";
import type { EmbeddingProvider } from "./app-storage.ts";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

async function readLimited(response: Response, signal: AbortSignal) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel("response too large"); throw new AiRuntimeError("EMBEDDING_RESPONSE_TOO_LARGE", "Embedding response exceeds 8 MiB"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export type OpenAiEmbeddingProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  fetcher?: typeof globalThis.fetch;
};

export function createOpenAiEmbeddingProvider(options: OpenAiEmbeddingProviderOptions): EmbeddingProvider {
  const model = options.model.trim();
  if (!model) throw new AiRuntimeError("EMBEDDING_PROVIDER_INVALID", "Embedding model cannot be empty");
  return {
    model,
    async embed({ texts, signal }) {
      const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) throw new AiRuntimeError("MISSING_API_KEY", "OPENAI_API_KEY is required for embeddings");
      if (!texts.length) return [];
      const base = (options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
      const url = await validateResolvedPublicUrl(`${base}/embeddings`, { signal });
      const response = await (options.fetcher ?? globalThis.fetch)(url, {
        method: "POST",
        redirect: "manual",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ model, input: texts }),
        signal,
      });
      if (response.status >= 300 && response.status < 400) throw new AiRuntimeError("EMBEDDING_REDIRECT", "Embedding provider redirects are not allowed");
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new AiRuntimeError("EMBEDDING_RESPONSE_TOO_LARGE", "Embedding response exceeds 8 MiB");
      const bytes = await readLimited(response, signal);
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch (error) { throw new AiRuntimeError("EMBEDDING_RESPONSE_INVALID", "Embedding provider returned invalid JSON", { cause: error }); }
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload ? JSON.stringify((payload as { error: unknown }).error).slice(0, 1_000) : response.statusText;
        throw new AiRuntimeError("EMBEDDING_REQUEST_FAILED", `Embedding provider returned HTTP ${response.status}: ${message}`);
      }
      const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : undefined;
      if (!Array.isArray(data) || data.length !== texts.length) throw new AiRuntimeError("EMBEDDING_RESPONSE_INVALID", "Embedding provider returned an unexpected vector count");
      return data.map((item) => {
        const vector = item && typeof item === "object" ? (item as { embedding?: unknown }).embedding : undefined;
        if (!Array.isArray(vector) || !vector.length || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
          throw new AiRuntimeError("EMBEDDING_RESPONSE_INVALID", "Embedding provider returned an invalid vector");
        }
        return vector as number[];
      });
    },
  };
}
