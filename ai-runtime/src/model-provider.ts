import { ChatOpenAI } from "@langchain/openai";
import type { AIMessageChunk, BaseMessageLike } from "@langchain/core/messages";
import { contentToText } from "../../../lib/workspace-tool-calling.ts";
import { validateResolvedPublicUrl } from "../../../lib/network-security.ts";
import type { WorkspaceToolCall, WorkspaceToolDefinition } from "../../../lib/workspace-tool-calling.ts";
import { AiRuntimeError } from "./errors.ts";

export type ModelEvent =
  | { type: "token"; text: string }
  | { type: "tool-call-delta"; index: number; id?: string; name?: string; arguments?: string };

export type ModelReply = {
  content: string;
  toolCalls?: WorkspaceToolCall[];
  raw?: unknown;
};

export type ModelProvider = {
  model?: string;
  supportsTools?: boolean;
  call(input: {
    messages: unknown[];
    tools: WorkspaceToolDefinition[];
    forceFinal: boolean;
    signal: AbortSignal;
    onEvent?: (event: ModelEvent) => void;
  }): Promise<ModelReply>;
};

export type ProviderConfig = {
  type?: "openai";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  embeddingModel?: string;
  provider?: ModelProvider;
};

function parseToolCalls(value: unknown): WorkspaceToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const call = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    let args = call.args;
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    return { id: String(call.id || `call_${index}`), name: String(call.name || ""), args: args ?? {} };
  }).filter((call) => call.name);
}

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
      let response: AIMessageChunk | undefined;
      for await (const chunk of stream) {
        const text = contentToText(chunk.content);
        if (text) input.onEvent({ type: "token", text });
        for (const call of chunk.tool_call_chunks ?? []) input.onEvent({
          type: "tool-call-delta",
          index: call.index ?? 0,
          ...(call.id ? { id: call.id } : {}),
          ...(call.name ? { name: call.name } : {}),
          ...(call.args ? { arguments: call.args } : {}),
        });
        response = response ? response.concat(chunk) : chunk;
      }
      if (!response) throw new AiRuntimeError("PROVIDER_RESPONSE_INVALID", "OpenAI-compatible provider returned an empty stream");
      return { content: contentToText(response.content), toolCalls: parseToolCalls(response.tool_calls), raw: response };
    }
    const response = await target.invoke(input.messages as BaseMessageLike[], { signal: input.signal });
    return {
      content: contentToText(response.content),
      toolCalls: parseToolCalls((response as unknown as { tool_calls?: unknown }).tool_calls),
      raw: response,
    };
  }
}
