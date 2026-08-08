import type { AppInteractionConfig, FlowNode, FlowProject } from "../../../domain/flow/types.ts";
import type { CommonNodeOptions, FlowFinishIdentity, NodeRef, Position, PreparedApp, SdkFlowNode, SkillDefinition, VariableKind, VariableRef, Visualization } from "./model-types.ts";
export type FlowGraphState = {
    id: string;
    nodes: SdkFlowNode[];
    edges: FlowProject["edges"];
    variables: Map<string, VariableRef<unknown>>;
    producers: Map<string, string>;
    positions: Map<string, Position>;
    branchConsumers: Map<string, string>;
    lastNodeId: string;
};
export declare function createFlowGraph(initial: readonly VariableRef<unknown>[]): FlowGraphState;
export declare function registerVariable(state: FlowGraphState, ref: VariableRef<unknown>): void;
export declare function addFlowNode<T>(state: FlowGraphState, type: Exclude<SdkFlowNode["type"], "START">, options: CommonNodeOptions<T>, config: Record<string, unknown>, source: unknown, kind: VariableKind, details?: {
    note?: string;
    workspace?: FlowNode["workspace"];
}): NodeRef<T>;
export declare function finishFlow(state: FlowGraphState, name: string, skills: readonly SkillDefinition[], visualizations: readonly Visualization[], interaction?: AppInteractionConfig, identity?: FlowFinishIdentity, execution?: FlowProject["execution"]): PreparedApp["project"];
