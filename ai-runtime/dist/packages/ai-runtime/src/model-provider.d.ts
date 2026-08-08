import type { ModelProvider, ModelReply, ProviderConfig } from "./runtime/contracts/ModelPort.ts";
export type { ModelEvent, ModelProvider, ModelReply, ProviderConfig } from "./runtime/contracts/ModelPort.ts";
export declare class OpenAiCompatibleProvider implements ModelProvider {
    readonly model: string;
    private readonly apiKey?;
    private readonly baseUrl;
    private readonly temperature;
    private readonly maxTokens;
    constructor(config: ProviderConfig);
    call(input: Parameters<ModelProvider["call"]>[0]): Promise<ModelReply>;
}
