import { validateResolvedPublicUrl } from "../../../../lib/network-security.ts";
import { AiRuntimeError } from "../errors.ts";
import type { HttpRequestExecutorInput } from "./HttpRequestExecutor.ts";
import type { ModelProvider, ModelReply } from "./contracts/ModelPort.ts";
import type { RequestTransformContext, RequestTransformResult } from "../provider-contracts.ts";

function freeze(value: unknown): unknown { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const item of Object.values(value as Record<string, unknown>)) freeze(item); return value; }
export async function transformHttpRequest(input: HttpRequestExecutorInput, request: Parameters<ModelProvider["call"]>[0]) {
  const context = structuredClone({ messages: input.normalizeMessages(request.messages), tools: request.tools, model: input.model, temperature: input.temperature, maxTokens: input.maxTokens, forceFinal: request.forceFinal }) as RequestTransformContext;
  try { return input.validateTransform(await input.transform(freeze(context) as RequestTransformContext)); }
  catch (error) { if (error instanceof AiRuntimeError) throw error; throw new AiRuntimeError("HTTP_TRANSFORM_FAILED", "requestTransformer failed", { cause: error }); }
}
function body(value: RequestTransformResult["body"]) { try { const result = JSON.stringify(value); if (result === undefined) throw new Error("undefined"); return result; } catch (error) { throw new AiRuntimeError("HTTP_TRANSFORM_INVALID", "requestTransformer body must be JSON-compatible and defined", { cause: error }); } }
export async function sendHttpProviderRequest(input: HttpRequestExecutorInput, request: Parameters<ModelProvider["call"]>[0], transformed: RequestTransformResult, signal: AbortSignal): Promise<ModelReply> {
  const url = new URL(input.endpoint); input.applyQuery(url, transformed.query);
  try { await validateResolvedPublicUrl(url, { signal }); } catch (error) { if (signal.aborted) throw error; throw new AiRuntimeError("HTTP_PROVIDER_URL_REJECTED", "HTTP provider URL failed public HTTPS validation", { cause: error }); }
  let response: Response;
  try { response = await input.fetcher(url, { method: input.method, headers: input.headers(transformed), body: body(transformed.body), redirect: "manual", signal }); }
  catch (error) { if (signal.aborted || error instanceof AiRuntimeError) throw error; throw new AiRuntimeError("HTTP_PROVIDER_REQUEST_FAILED", "HTTP provider request failed", { cause: error }); }
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new AiRuntimeError("HTTP_PROVIDER_REDIRECT", "HTTP provider redirects are not allowed");
  if (!response.ok) throw new AiRuntimeError("HTTP_PROVIDER_HTTP_ERROR", `HTTP provider returned status ${response.status}`);
  return input.parseResponse(response, signal, request.onEvent);
}
