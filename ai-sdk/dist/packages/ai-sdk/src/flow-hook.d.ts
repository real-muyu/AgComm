import type { PluginContext, PluginTool, PluginValue } from "./plugin.ts";
import { type BundleLimits } from "./portable.ts";
export type FlowHookValue = PluginValue;
export type FlowHookContext = PluginContext;
export type FlowHookState = PluginValue;
export type FlowHookLimits = BundleLimits;
export type FlowHookNode = {
    id: string;
    title: string;
    type: string;
    config: Record<string, FlowHookValue>;
};
export type FlowHookBaseEvent<TState extends FlowHookState> = {
    node: FlowHookNode;
    variables: Readonly<Record<string, FlowHookValue>>;
    inputs: readonly FlowHookValue[];
    state: TState | null;
};
export type FlowHookBeforeNodeEvent<TState extends FlowHookState> = FlowHookBaseEvent<TState> & {
    attempt: number;
};
export type FlowHookAfterNodeEvent<TState extends FlowHookState> = FlowHookBeforeNodeEvent<TState> & {
    output: FlowHookValue;
    skipped: boolean;
    recovered: boolean;
};
export type FlowHookNodeErrorEvent<TState extends FlowHookState> = FlowHookBaseEvent<TState> & {
    attempts: number;
    error: {
        name: string;
        code?: string;
        message: string;
    };
};
export type FlowHookCommonResult<TState extends FlowHookState> = {
    state?: TState | null;
};
export type FlowHookBeforeNodeResult<TState extends FlowHookState> = FlowHookCommonResult<TState> & {
    config?: Record<string, FlowHookValue>;
    skipWith?: FlowHookValue;
};
export type FlowHookAfterNodeResult<TState extends FlowHookState> = FlowHookCommonResult<TState> & {
    output?: FlowHookValue;
};
export type FlowHookNodeErrorResult<TState extends FlowHookState> = FlowHookCommonResult<TState> & {
    recoverWith?: FlowHookValue;
};
type Handler<TEvent, TResult> = {
    bivarianceHack(event: TEvent, context: FlowHookContext): TResult | void | Promise<TResult | void>;
}["bivarianceHack"];
export type FlowHookHandlers<TState extends FlowHookState = FlowHookState> = {
    beforeNode?: Handler<FlowHookBeforeNodeEvent<TState>, FlowHookBeforeNodeResult<TState>>;
    afterNode?: Handler<FlowHookAfterNodeEvent<TState>, FlowHookAfterNodeResult<TState>>;
    onNodeError?: Handler<FlowHookNodeErrorEvent<TState>, FlowHookNodeErrorResult<TState>>;
};
export type FlowHookOperation = keyof FlowHookHandlers;
export type FlowHookDefinition<TState extends FlowHookState = FlowHookState> = {
    readonly entry: string;
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly permissions: readonly string[];
    readonly limits?: FlowHookLimits;
    readonly handlers: FlowHookHandlers<TState>;
    readonly tools: Record<string, PluginTool>;
};
export type DefineFlowHookOptions<TState extends FlowHookState> = Omit<FlowHookDefinition<TState>, "permissions" | "tools"> & {
    permissions?: readonly string[];
};
export declare const FLOW_HOOK_OPERATIONS: readonly ["beforeNode", "afterNode", "onNodeError"];
export declare const FLOW_HOOK_SCHEMAS: Readonly<Record<FlowHookOperation, {
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
}>>;
export declare function defineFlowHook<TState extends FlowHookState = FlowHookState>(options: DefineFlowHookOptions<TState>): FlowHookDefinition<TState>;
export {};
