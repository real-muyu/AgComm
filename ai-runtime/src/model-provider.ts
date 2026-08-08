import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessageLike } from "@langchain/core/messages";
import { validateResolvedPublicUrl } from "../../../lib/network-security.ts";
import { AiRuntimeError } from "./errors.ts";
import type { ModelProvider, ModelReply, ProviderConfig } from "./runtime/contracts/ModelPort.ts";
import { modelReply, streamModelReply } from "./runtime/model/ModelResponse.ts";
export type { ModelEvent, ModelProvider, ModelReply, ProviderConfig } from "./runtime/contracts/ModelPort.ts";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function createStreamingFetch(signal: AbortSignal, maximum = 4_194_304): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
    await validateResolvedPublicUrl(url, { signal });
    const combinedSignal = init.signal ? AbortSignal.any([signal, init.signal]) : signal;
    const response = await globalThis.fetch(url, { ...init, redirect: "manual", signal: combinedSignal });
    if (REDIRECT_STATUSES.has(response.status)) throw new AiRuntimeError("PROVIDER_REDIRECT", "OpenAI-compatible provider redirects are not allowed");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximum) throw new AiRuntimeError("PROVIDER_RESPONSE_TOO_LARGE", "OpenAI-compatible provider response exceeds 4 MiB");
    if (!response.body) return response;
    const reader = response.body.getReader();
    let total = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (combinedSignal.aborted) throw combinedSignal.reason ?? new DOMException("Aborted", "AbortError");
          const { done, value } = await reader.read();
          if (done) { controller.close(); return; }
          total += value.byteLength;
          if (total > maximum) {
            await reader.cancel("response too large");
            throw new AiRuntimeError("PROVIDER_RESPONSE_TOO_LARGE", "OpenAI-compatible provider response exceeds 4 MiB");
          }
          controller.enqueue(value);
        } catch (error) { controller.error(error); }
      },
      async cancel(reason) { await reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = (config.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = config.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
    this.temperature = Math.max(0, Math.min(2, Number(config.temperature ?? 0.3)));
    this.maxTokens = Math.max(64, Math.min(32_768, Number(config.maxTokens ?? 2_048)));
  }

  async call(input: Parameters<ModelProvider["call"]>[0]): Promise<ModelReply> {
    if (!this.apiKey) throw new AiRuntimeError("MISSING_API_KEY", "OPENAI_API_KEY is required for Skill and Workspace nodes");
    const baseUrl = await validateResolvedPublicUrl(this.baseUrl, { signal: input.signal });
    const model = new ChatOpenAI({
      apiKey: this.apiKey,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      maxRetries: 1,
      timeout: 60_000,
      configuration: { baseURL: baseUrl.toString().replace(/\/$/, ""), fetch: createStreamingFetch(input.signal) },
    });
    const target = input.tools.length && !input.forceFinal ? model.bindTools(input.tools as never[]) : model;
    if (input.onEvent) {
      const stream = await target.stream(input.messages as BaseMessageLike[], { signal: input.signal });
      return streamModelReply(stream, input.onEvent);
    }
    const response = await target.invoke(input.messages as BaseMessageLike[], { signal: input.signal });
    return modelReply(response as unknown as { content: unknown; tool_calls?: unknown });
  }
}
