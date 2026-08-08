import type { EmbeddingProvider } from "../app-storage.ts";
import { OpenAiCompatibleProvider, type ModelProvider } from "../model-provider.ts";
import type { RuntimeOptions } from "../runtime-types.ts";
export declare function createRuntimeProviders(options: RuntimeOptions): {
    config: import("./contracts/ModelPort.ts").ProviderConfig;
    provider: ModelProvider | OpenAiCompatibleProvider;
    embeddingProvider: EmbeddingProvider | undefined;
    providerInjected: boolean;
};
