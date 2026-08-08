import { type WorkspaceAgentReply, type WorkspaceToolCall, type WorkspaceToolEvent } from "../../../../lib/workspace-tool-calling.ts";
import type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
import type { RuntimeEvent } from "../runtime-types.ts";
import { type HookTool } from "./HookValues.ts";
import type { PluginManager } from "./PluginManager.ts";
export type { HookTool } from "./HookValues.ts";
export declare class WorkspaceHookPipeline {
    private readonly enteredTools;
    private readonly context;
    stage: "workspace" | "model" | "tool";
    iteration: number;
    constructor(workspaceId: string, hookIds: readonly string[], variables: Readonly<Record<string, unknown>>, manager: PluginManager, signal: AbortSignal, emit: (event: RuntimeEvent) => void);
    get variables(): Readonly<Record<string, PluginValue>>;
    private invoke;
    private get hookIds();
    start(input: string): Promise<string>;
    beforeModel(input: string, messages: readonly unknown[], tools: readonly HookTool[], forceFinal: boolean): Promise<string[]>;
    afterModel(reply: WorkspaceAgentReply, forceFinal: boolean, resolveTool: (call: WorkspaceToolCall) => HookTool): Promise<WorkspaceAgentReply | {
        content: string;
        raw: any;
        toolCalls?: WorkspaceToolCall[];
    }>;
    beforeTool(event: WorkspaceToolEvent & {
        rawInput: unknown;
    }): Promise<{
        input: PluginValue;
        skipWith: string;
    } | {
        input: PluginValue;
        skipWith?: undefined;
    }>;
    afterTool(event: WorkspaceToolEvent & {
        rawInput: unknown;
        output: string;
        skipped: boolean;
    }): Promise<{
        output: string;
    }>;
    finish(output: string): Promise<string>;
    error(error: unknown, tool?: HookTool): Promise<void>;
}
