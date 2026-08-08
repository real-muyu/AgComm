import { AiRuntimeError } from "../errors.ts";
import type { ModelProvider, ModelReply } from "./contracts/ModelPort.ts";
import type { RequestTransformContext, RequestTransformResult } from "../provider-contracts.ts";
import { sendHttpProviderRequest, transformHttpRequest } from "./HttpRequestLifecycle.ts";

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
  parseResponse(response: Response, signal: AbortSignal, onEvent?: ModelProvider["call"] extends (input: infer T) => unknown ? T extends { onEvent?: infer E } ? E : never : never): Promise<ModelReply>;
};

export function createHttpRequestExecutor(input: HttpRequestExecutorInput) {
  return async function execute(request: Parameters<ModelProvider["call"]>[0]) {
    if (request.signal.aborted) throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
    if (request.tools.length && !request.forceFinal && !input.supportsTools) throw new AiRuntimeError("PROVIDER_TOOLS_UNSUPPORTED", "HTTP provider does not define tool-call response mapping");
    const transformed = await transformHttpRequest(input, request);
    const controller = new AbortController();
    const cancel = () => controller.abort(request.signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (request.signal.aborted) cancel(); else request.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("HTTP provider timed out", "TimeoutError")), input.timeoutMs);
    try {
      try { return await sendHttpProviderRequest(input, request, transformed, controller.signal); }
      catch (error) { if (request.signal.aborted) throw request.signal.reason ?? error; if (controller.signal.aborted) throw new AiRuntimeError("HTTP_PROVIDER_TIMEOUT", "HTTP provider response timed out", { cause: error }); throw error; }
    } finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); }
  };
}
