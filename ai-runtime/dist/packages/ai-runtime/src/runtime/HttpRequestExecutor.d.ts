import type { ModelProvider, ModelReply } from "./contracts/ModelPort.ts";
import type { RequestTransformContext, RequestTransformResult } from "../provider-contracts.ts";
export type HttpRequestExecutorInput = {
    endpoint: URL;
    method: string;
    timeoutMs: number;
    model: string;
    temperature: number;
    maxTokens: number;
    supportsTools: boolean;
    fetcher: typeof fetch;
    transform(context: RequestTransformContext): RequestTransformResult | Promise<RequestTransformResult>;
    normalizeMessages(messages: unknown[]): unknown[];
    validateTransform(value: unknown): RequestTransformResult;
    headers(result: RequestTransformResult): Headers;
    applyQuery(url: URL, query: RequestTransformResult["query"]): void;
    parseResponse(response: Response, signal: AbortSignal, onEvent?: ModelProvider["call"] extends (input: infer T) => unknown ? T extends {
        onEvent?: infer E;
    } ? E : never : never): Promise<ModelReply>;
};
export declare function createHttpRequestExecutor(input: HttpRequestExecutorInput): (request: Parameters<ModelProvider["call"]>[0]) => Promise<ModelReply>;
