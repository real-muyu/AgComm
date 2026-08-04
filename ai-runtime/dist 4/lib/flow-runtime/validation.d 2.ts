import type { ExecutionPlan, FlowDefinition, FlowEdge, ValidationResult } from "./types.ts";
export declare function normalizeEdges(edges: FlowEdge[]): Array<FlowEdge & {
    id: string;
}>;
export declare function validateFlow(flow: FlowDefinition): ValidationResult;
export declare function buildExecutionPlan(flow: FlowDefinition, validation?: ValidationResult): ExecutionPlan;
