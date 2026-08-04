import { type ExecutorRegistry, type FlowNode, type NodeExecutionContext, type NodeExecutor, type NodeResult } from "./types.ts";
export declare class StartExecutor implements NodeExecutor {
    execute(_node: FlowNode, context: NodeExecutionContext): Promise<NodeResult>;
}
export declare class InputExecutor implements NodeExecutor {
    execute(node: FlowNode, context: NodeExecutionContext): Promise<NodeResult>;
}
export declare class SkillExecutor implements NodeExecutor {
    execute(node: FlowNode, context: NodeExecutionContext): Promise<NodeResult>;
}
export declare class WorkspaceExecutor implements NodeExecutor {
    execute(node: FlowNode, context: NodeExecutionContext): Promise<NodeResult>;
}
export declare class HttpExecutor implements NodeExecutor {
    execute(node: FlowNode, context: NodeExecutionContext): Promise<NodeResult>;
}
export declare class ConditionExecutor implements NodeExecutor {
    execute(node: FlowNode, context: NodeExecutionContext): Promise<NodeResult>;
}
export declare class OutputExecutor implements NodeExecutor {
    execute(node: FlowNode, context: NodeExecutionContext): Promise<NodeResult>;
}
export declare function createDefaultExecutors(): ExecutorRegistry;
