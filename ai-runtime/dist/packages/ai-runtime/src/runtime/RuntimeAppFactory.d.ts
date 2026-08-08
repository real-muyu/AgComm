import type { EmbeddingProvider } from "../app-storage.ts";
import type { AiAppHandle, RuntimeOptions } from "../runtime-types.ts";
import type { RuntimeAppExecutionPort } from "./contracts/RuntimeAppPort.ts";
export type RuntimeAppFactoryOptions = RuntimeAppExecutionPort & {
    runtimeOptions: RuntimeOptions;
    embeddingProvider?: EmbeddingProvider;
    activeApps: Set<AiAppHandle>;
};
export declare function createRuntimeAppFactory(options: RuntimeAppFactoryOptions): (pathOrBytes: string | Uint8Array | ArrayBuffer) => Promise<AiAppHandle>;
