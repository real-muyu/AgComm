import type { EmbeddingProvider } from "./app-storage.ts";
export type OpenAiEmbeddingProviderOptions = {
    apiKey?: string;
    baseUrl?: string;
    model: string;
    fetcher?: typeof globalThis.fetch;
};
export declare function createOpenAiEmbeddingProvider(options: OpenAiEmbeddingProviderOptions): EmbeddingProvider;
