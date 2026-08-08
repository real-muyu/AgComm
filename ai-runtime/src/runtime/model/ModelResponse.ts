import type { AIMessageChunk } from "@langchain/core/messages";
import { contentToText, type WorkspaceToolCall } from "../../../../../lib/workspace-tool-calling.ts";
import { AiRuntimeError } from "../../errors.ts";
import type { ModelEvent, ModelReply } from "../contracts/ModelPort.ts";

function parseToolCalls(value: unknown): WorkspaceToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const call = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    let args = call.args;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    return { id: String(call.id || `call_${index}`), name: String(call.name || ""), args: args ?? {} };
  }).filter((call) => call.name);
}

export function modelReply(response: { content: unknown; tool_calls?: unknown }): ModelReply {
  return { content: contentToText(response.content), toolCalls: parseToolCalls(response.tool_calls), raw: response };
}

export async function streamModelReply(stream: AsyncIterable<AIMessageChunk>, emit: (event: ModelEvent) => void): Promise<ModelReply> {
  let response: AIMessageChunk | undefined;
  for await (const chunk of stream) {
    const text = contentToText(chunk.content);
    if (text) emit({ type: "token", text });
    for (const call of chunk.tool_call_chunks ?? []) emit({ type: "tool-call-delta", index: call.index ?? 0, ...(call.id ? { id: call.id } : {}), ...(call.name ? { name: call.name } : {}), ...(call.args ? { arguments: call.args } : {}) });
    response = response ? response.concat(chunk) : chunk;
  }
  if (!response) throw new AiRuntimeError("PROVIDER_RESPONSE_INVALID", "OpenAI-compatible provider returned an empty stream");
  return modelReply(response);
}
