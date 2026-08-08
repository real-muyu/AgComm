import type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
import type { RuntimeEvent } from "../runtime-types.ts";
import type { PluginManager } from "./PluginManager.ts";
export declare class WorkspaceHookContext {
    private readonly workspaceId;
    readonly hookIds: readonly string[];
    private readonly manager;
    private readonly signal;
    private readonly emit;
    private readonly states;
    private localVariables;
    constructor(workspaceId: string, hookIds: readonly string[], variables: Readonly<Record<string, unknown>>, manager: PluginManager, signal: AbortSignal, emit: (event: RuntimeEvent) => void);
    get variables(): Readonly<Record<string, PluginValue>>;
    invoke(hookId: string, operation: string, iteration: number, payload: Record<string, PluginValue>): Promise<Record<string, PluginValue>>;
    private applyResult;
}
