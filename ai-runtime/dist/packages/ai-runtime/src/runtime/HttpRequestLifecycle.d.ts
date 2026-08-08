import type { HttpRequestExecutorInput } from "./HttpRequestExecutor.ts";
import type { ModelProvider, ModelReply } from "./contracts/ModelPort.ts";
import type { RequestTransformResult } from "../provider-contracts.ts";
export declare function transformHttpRequest(input: HttpRequestExecutorInput, request: Parameters<ModelProvider["call"]>[0]): Promise<RequestTransformResult>;
export declare function sendHttpProviderRequest(input: HttpRequestExecutorInput, request: Parameters<ModelProvider["call"]>[0], transformed: RequestTransformResult, signal: AbortSignal): Promise<ModelReply>;
