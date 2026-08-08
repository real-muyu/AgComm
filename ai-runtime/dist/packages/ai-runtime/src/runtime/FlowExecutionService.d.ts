import type { RuntimeServices } from "../../../../lib/flow-runtime/types.ts";
import type { BackgroundRunServices } from "../background-context.ts";
import type { FlowHookPipeline } from "./FlowHookPipeline.ts";
import type { PluginManager } from "./PluginManager.ts";
import type { RuntimeProject } from "./PackageParser.ts";
export type FlowExecutionInput = {
    project: RuntimeProject;
    context: {
        background?: BackgroundRunServices;
    };
    controller: AbortController;
    renderer?: any;
    variables: Record<string, unknown>;
    manager: PluginManager;
    flowHooks: FlowHookPipeline;
    runSkill: NonNullable<RuntimeServices["runSkill"]>;
    runWorkspace: NonNullable<RuntimeServices["runWorkspace"]>;
    outputStream?: {
        completeOutput(nodeId: string, value: unknown): void;
    };
    emit(event: any): void;
};
export declare function executeFlow(input: FlowExecutionInput): Promise<import("../../../../lib/flow-runtime/types.ts").FlowRunResult>;
