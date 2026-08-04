import type { PluginContext, PluginTool, PluginValue } from "../../../runtime/plugins/sdk.ts";
import { type BundleLimits } from "./portable.ts";
export type WorkspaceHookValue = PluginValue;
export type WorkspaceHookContext = PluginContext;
export type WorkspaceHookVariables = Record<string, WorkspaceHookValue>;
export type WorkspaceHookLimits = BundleLimits;
export type WorkspaceHookMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    toolCallId?: string;
};
export type WorkspaceHookTool = {
    id: string;
    name: string;
    kind: "skill" | "plugin";
};
export type WorkspaceHookToolCall = WorkspaceHookTool & {
    callId?: string;
    input: WorkspaceHookValue;
};
export type WorkspaceHookBaseEvent<TState extends WorkspaceHookValue> = {
    workspaceId: string;
    iteration: number;
    variables: Readonly<WorkspaceHookVariables>;
    state: TState | null;
};
export type WorkspaceHookStartEvent<TState extends WorkspaceHookValue> = WorkspaceHookBaseEvent<TState> & {
    input: string;
};
export type WorkspaceHookBeforeModelEvent<TState extends WorkspaceHookValue> = WorkspaceHookBaseEvent<TState> & {
    input: string;
    forceFinal: boolean;
    messages: readonly WorkspaceHookMessage[];
    tools: readonly WorkspaceHookTool[];
};
export type WorkspaceHookAfterModelEvent<TState extends WorkspaceHookValue> = WorkspaceHookBaseEvent<TState> & {
    forceFinal: boolean;
    content: string;
    toolCalls: readonly WorkspaceHookToolCall[];
};
export type WorkspaceHookBeforeToolEvent<TState extends WorkspaceHookValue> = WorkspaceHookBaseEvent<TState> & {
    tool: WorkspaceHookTool;
    callId?: string;
    input: WorkspaceHookValue;
};
export type WorkspaceHookAfterToolEvent<TState extends WorkspaceHookValue> = WorkspaceHookBeforeToolEvent<TState> & {
    output: string;
    skipped: boolean;
};
export type WorkspaceHookFinishEvent<TState extends WorkspaceHookValue> = WorkspaceHookBaseEvent<TState> & {
    output: string;
};
export type WorkspaceHookErrorEvent<TState extends WorkspaceHookValue> = WorkspaceHookBaseEvent<TState> & {
    stage: "workspace" | "model" | "tool";
    error: {
        name: string;
        code?: string;
        message: string;
    };
    tool?: WorkspaceHookTool;
};
export type WorkspaceHookCommonResult<TState extends WorkspaceHookValue> = {
    state?: TState | null;
    variables?: WorkspaceHookVariables;
};
export type WorkspaceHookStartResult<TState extends WorkspaceHookValue> = WorkspaceHookCommonResult<TState> & {
    input?: string;
};
export type WorkspaceHookBeforeModelResult<TState extends WorkspaceHookValue> = WorkspaceHookCommonResult<TState> & {
    systemInstruction?: string;
};
export type WorkspaceHookAfterModelResult<TState extends WorkspaceHookValue> = WorkspaceHookCommonResult<TState> & {
    content?: string;
};
export type WorkspaceHookBeforeToolResult<TState extends WorkspaceHookValue> = WorkspaceHookCommonResult<TState> & {
    input?: WorkspaceHookValue;
    skipWith?: string;
};
export type WorkspaceHookAfterToolResult<TState extends WorkspaceHookValue> = WorkspaceHookCommonResult<TState> & {
    output?: string;
};
export type WorkspaceHookFinishResult<TState extends WorkspaceHookValue> = WorkspaceHookCommonResult<TState> & {
    output?: string;
};
type Handler<TEvent, TResult> = {
    bivarianceHack(event: TEvent, context: WorkspaceHookContext): TResult | void | Promise<TResult | void>;
}["bivarianceHack"];
export type WorkspaceHookHandlers<TState extends WorkspaceHookValue = WorkspaceHookValue> = {
    onStart?: Handler<WorkspaceHookStartEvent<TState>, WorkspaceHookStartResult<TState>>;
    beforeModel?: Handler<WorkspaceHookBeforeModelEvent<TState>, WorkspaceHookBeforeModelResult<TState>>;
    afterModel?: Handler<WorkspaceHookAfterModelEvent<TState>, WorkspaceHookAfterModelResult<TState>>;
    beforeTool?: Handler<WorkspaceHookBeforeToolEvent<TState>, WorkspaceHookBeforeToolResult<TState>>;
    afterTool?: Handler<WorkspaceHookAfterToolEvent<TState>, WorkspaceHookAfterToolResult<TState>>;
    onFinish?: Handler<WorkspaceHookFinishEvent<TState>, WorkspaceHookFinishResult<TState>>;
    onError?: Handler<WorkspaceHookErrorEvent<TState>, never>;
};
export type WorkspaceHookOperation = keyof WorkspaceHookHandlers;
export type WorkspaceHookDefinition<TState extends WorkspaceHookValue = WorkspaceHookValue> = {
    readonly entry: string;
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly permissions: readonly string[];
    readonly limits?: WorkspaceHookLimits;
    readonly handlers: WorkspaceHookHandlers<TState>;
    readonly tools: Record<string, PluginTool>;
};
export type DefineWorkspaceHookOptions<TState extends WorkspaceHookValue> = Omit<WorkspaceHookDefinition<TState>, "permissions" | "tools"> & {
    permissions?: readonly string[];
};
export declare const WORKSPACE_HOOK_OPERATIONS: readonly ["onStart", "beforeModel", "afterModel", "beforeTool", "afterTool", "onFinish", "onError"];
export declare const WORKSPACE_HOOK_SCHEMAS: Readonly<Record<WorkspaceHookOperation, {
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
}>>;
export declare function defineWorkspaceHook<TState extends WorkspaceHookValue = WorkspaceHookValue>(options: DefineWorkspaceHookOptions<TState>): WorkspaceHookDefinition<TState>;
export {};
