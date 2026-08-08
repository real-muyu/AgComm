import { type WorkspaceToolCall, type WorkspaceToolDefinition, type WorkspaceToolTrace } from "../../../../lib/workspace-tool-calling.ts";
import type { Skill } from "../../../../domain/flow/types.ts";
import { type PluginManager } from "./PluginManager.ts";
import type { ModelInvocationContext, RuntimeEvent } from "../runtime-types.ts";
type CallProvider = (messages: unknown[], tools: WorkspaceToolDefinition[], forceFinal: boolean, signal: AbortSignal, invocation: Omit<ModelInvocationContext, "callId" | "forceFinal">) => Promise<{
    content: string;
    toolCalls?: WorkspaceToolCall[];
    raw?: unknown;
}>;
type SkillRunner = (skill: Skill, input: unknown, variables: Readonly<Record<string, unknown>>, signal: AbortSignal, node: {
    id: string;
}, topLevel?: boolean) => Promise<string>;
export declare function createWorkspaceExecutor(input: {
    manager: PluginManager;
    callProvider: CallProvider;
    messagesFor(system: string, text: string, topLevel: boolean): unknown[];
    runSkill: SkillRunner;
    toolCalls: WorkspaceToolTrace[];
    emit(event: RuntimeEvent): void;
}): (agent: Skill, skills: Skill[], input: unknown, maxIterations: number, runtimeVariables: Readonly<Record<string, unknown>>, signal: AbortSignal, node: {
    id: string;
    config?: Record<string, unknown>;
}) => Promise<string>;
export {};
