import { contentToText } from "../../../../lib/workspace-tool-calling.ts";
import type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
import { AiRuntimeError } from "../errors.ts";

export const HOOK_RESERVED_VARIABLES = new Set(["session_id", "conversation_history", "knowledge_context", "background_trigger", "gateway_run_id"]);
export type HookTool = { id: string; name: string; kind: "skill" | "plugin" };
export function toHookValue(value: unknown): PluginValue { if (value === undefined) return null; try { const encoded = JSON.stringify(value); return encoded === undefined ? null : JSON.parse(encoded) as PluginValue; } catch (error) { throw new AiRuntimeError("WORKSPACE_HOOK_VALUE_INVALID", "Workspace Hook data must be JSON serializable", { cause: error }); } }
export function hookRecord(value: PluginValue): Record<string, PluginValue> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, PluginValue> : {}; }
export function normalizedHookMessage(value: unknown): { role: "system" | "user" | "assistant" | "tool"; content: string; name?: string; toolCallId?: string } { const item = value && typeof value === "object" ? value as Record<string, unknown> : {}; const detected = typeof item.role === "string" ? item.role : typeof item._getType === "function" ? String((item._getType as () => unknown)()) : "assistant"; const role = detected === "human" || detected === "user" ? "user" : detected === "system" ? "system" : detected === "tool" ? "tool" : "assistant"; return { role, content: contentToText(item.content ?? value), ...(typeof item.name === "string" ? { name: item.name } : {}), ...(typeof item.tool_call_id === "string" ? { toolCallId: item.tool_call_id } : {}) }; }
