import type { ExecutorRegistry, RuntimeServices } from "../../../../lib/flow-runtime/types.ts";
import type { FlowExecutionInput } from "./FlowExecutionService.ts";
export declare function createNodeExecutorRegistry(input: FlowExecutionInput): {
    services: RuntimeServices;
    executors: ExecutorRegistry;
};
