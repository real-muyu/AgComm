import type { EmbeddingProvider } from "../app-storage.ts";
import { createOpenAiEmbeddingProvider } from "../embedding-provider.ts";
import { OpenAiCompatibleProvider, type ModelProvider } from "../model-provider.ts";
import type { RuntimeOptions } from "../runtime-types.ts";
import { resolveModelProvider, resolveProviderConfig } from "./RuntimeFactory.ts";

export function createRuntimeProviders(options: RuntimeOptions) {
  const injected = resolveModelProvider(options.provider);
  const config = resolveProviderConfig(options.provider);
  const provider = injected ?? new OpenAiCompatibleProvider(config);
  const candidate = options.provider as (ModelProvider & Partial<EmbeddingProvider>) | undefined;
  const embeddingModel = config.embeddingModel ?? process.env.OPENAI_EMBEDDING_MODEL;
  const embeddingProvider = options.embeddingProvider
    ?? (candidate && typeof candidate.embed === "function" && candidate.model
      ? candidate as EmbeddingProvider
      : embeddingModel
        ? createOpenAiEmbeddingProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: embeddingModel })
        : undefined);
  return { config, provider, embeddingProvider, providerInjected: Boolean(injected) };
}
