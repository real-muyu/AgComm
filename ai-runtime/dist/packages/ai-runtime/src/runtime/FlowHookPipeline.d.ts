import type { FlowNode as RuntimeFlowNode } from "../../../../lib/flow-runtime/index.ts";
import type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
import type { RuntimeEvent } from "../runtime-types.ts";
import type { PluginManager } from "./PluginManager.ts";
export declare class FlowHookPipeline {
    private readonly hookIds;
    private readonly manager;
    private readonly signal;
    private readonly emit;
    private readonly states;
    private readonly entered;
    constructor(hookIds: readonly string[], manager: PluginManager, signal: AbortSignal, emit: (event: RuntimeEvent) => void);
    private key;
    private base;
    private applyState;
    private invoke;
    beforeNode(event: {
        node: Readonly<RuntimeFlowNode>;
        attempt: number;
        variables: Readonly<Record<string, unknown>>;
        inputs: readonly unknown[];
        signal: AbortSignal;
    }): Promise<{
        config: Record<string, PluginValue>;
        skip: boolean;
        output: PluginValue;
    } | {
        config: Record<string, PluginValue>;
        skip?: undefined;
        output?: undefined;
    }>;
    afterNode(event: {
        node: Readonly<RuntimeFlowNode>;
        attempt: number;
        variables: Readonly<Record<string, unknown>>;
        inputs: readonly unknown[];
        signal: AbortSignal;
        output: unknown;
        skipped: boolean;
        recovered: boolean;
    }): Promise<PluginValue>;
    onNodeError(event: {
        node: Readonly<RuntimeFlowNode>;
        attempts: number;
        variables: Readonly<Record<string, unknown>>;
        inputs: readonly unknown[];
        signal: AbortSignal;
        error: Error;
    }): Promise<{
        recover: boolean;
        output: PluginValue;
    } | undefined>;
}
