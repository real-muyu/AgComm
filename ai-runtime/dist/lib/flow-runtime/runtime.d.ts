import { type FlowDefinition, type FlowRunResult, type RunOptions } from "./types.ts";
export declare class FlowRuntime {
    run(flow: FlowDefinition, options?: RunOptions): Promise<FlowRunResult>;
    private execute;
}
export declare function runFlow(flow: FlowDefinition, options?: RunOptions): Promise<FlowRunResult>;
