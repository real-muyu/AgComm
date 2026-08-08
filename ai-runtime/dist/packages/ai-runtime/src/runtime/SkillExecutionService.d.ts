import { type WorkspaceToolDefinition, type WorkspaceToolTrace } from "../../../../lib/workspace-tool-calling.ts";
import type { Skill } from "../../../../domain/flow/types.ts";
import { type PluginManager } from "./PluginManager.ts";
import type { ModelInvocationContext, RuntimeEvent } from "../runtime-types.ts";
type CallProvider = (messages: unknown[], tools: WorkspaceToolDefinition[], forceFinal: boolean, signal: AbortSignal, invocation: Omit<ModelInvocationContext, "callId" | "forceFinal">) => Promise<{
    content: string;
}>;
export declare function createSkillExecutor(input: {
    manager: PluginManager;
    callProvider: CallProvider;
    messagesFor(system: string, text: string, topLevel: boolean): unknown[];
    toolCalls: WorkspaceToolTrace[];
    emit(event: RuntimeEvent): void;
}): (skill: Skill, input: unknown, runtimeVariables: Readonly<Record<string, unknown>>, signal: AbortSignal, node: {
    id: string;
}, topLevel?: boolean) => Promise<string>;
export {};
