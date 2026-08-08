import type { ModelProvider } from "./runtime/contracts/ModelPort.ts";
import type { HttpModelProviderConfig } from "./provider-contracts.ts";
export type { HttpModelProviderConfig, HttpProviderAuth, JsonResponseMapping, RequestTransformContext, RequestTransformResult, SseResponseMapping, ToolCallMapping } from "./provider-contracts.ts";
export declare function collectHttpProviderSecrets(config: HttpModelProviderConfig, environment?: Readonly<Record<string, string | undefined>>): string[];
export declare function createHttpModelProvider(config: HttpModelProviderConfig): ModelProvider;
