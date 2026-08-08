import { compileFlow } from "../../../../domain/flow/compiler.ts";
import type { FlowRunResult, ExecutorRegistry, RuntimeServices } from "../../../../lib/flow-runtime/types.ts";
import type { FlowExecutionInput } from "./FlowExecutionService.ts";
export declare class FlowCheckpointController {
    private readonly input;
    private readonly flow;
    private readonly services;
    private readonly executors;
    constructor(input: FlowExecutionInput, flow: ReturnType<typeof compileFlow>, services: RuntimeServices, executors: ExecutorRegistry);
    run(): Promise<FlowRunResult>;
    private resumeInput;
}
