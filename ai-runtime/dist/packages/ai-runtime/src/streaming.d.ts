import type { ModelEvent, ModelReply } from "./runtime/contracts/ModelPort.ts";
import type { FlowProject } from "../../../domain/flow/types.ts";
import type { AiRunResult, AiRunStream, ModelInvocationContext } from "./runtime-types.ts";
export declare function createAiRunStream<T>(execute: (signal: AbortSignal, push: (value: T) => void) => Promise<AiRunResult>, options?: {
    externalSignal?: AbortSignal;
    errorAsItem?: (error: unknown) => T | undefined;
    closeOnError?: boolean;
}): AiRunStream<T>;
export declare function streamError(error: unknown): {
    code: string;
    name: string;
    message: string;
};
export declare function outputText(value: unknown): string;
export declare class OutputStreamCoordinator {
    private readonly publish;
    private readonly outputNodeId?;
    private readonly sourceNodeId?;
    private readonly sourceSafe;
    private readonly modelBuffers;
    private emitted;
    private completed;
    constructor(project: Pick<FlowProject, "nodes" | "edges" | "plugins">, publish: (text: string, nodeId?: string) => void);
    beginModel(context: ModelInvocationContext): void;
    modelEvent(context: ModelInvocationContext, event: ModelEvent): void;
    completeModel(context: ModelInvocationContext, reply: ModelReply): void;
    completeOutput(nodeId: string, output: unknown): void;
    completeRun(output: unknown): void;
    private emit;
    private complete;
}
