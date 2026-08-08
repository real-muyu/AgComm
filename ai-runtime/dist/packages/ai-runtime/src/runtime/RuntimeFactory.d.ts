import type { HttpModelProviderConfig } from "../provider-contracts.ts";
import type { ModelProvider, ProviderConfig } from "../model-provider.ts";
export declare function resolveModelProvider(value: ProviderConfig | HttpModelProviderConfig | ModelProvider | undefined): ModelProvider | undefined;
export declare function resolveProviderConfig(value: ProviderConfig | HttpModelProviderConfig | ModelProvider | undefined): ProviderConfig;
