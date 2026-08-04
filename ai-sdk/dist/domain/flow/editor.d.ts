import type { Connection, FlowNode, FlowProject } from "./types.ts";
export declare function connectionId(edge: Connection, index?: number): string;
export declare function createConnection(from: string, to: string, edges: Connection[]): Connection;
export declare function duplicateNode(node: FlowNode, nodes: FlowNode[]): FlowNode;
export declare function autoLayoutNodes(nodes: FlowNode[], edges: Connection[]): {
    x: number;
    y: number;
    id: string;
    title: string;
    type: import("./types.ts").FlowNodeType;
    icon: string;
    tone: string;
    note: string;
    outputVar: string;
    workspace?: import("./types.ts").WorkspaceConfig;
    config?: Record<string, unknown>;
    timeoutMs?: number;
}[];
export type ImportConflict = {
    kind: "node" | "skill" | "plugin" | "variable";
    id: string;
};
export declare function findImportConflicts(current: FlowProject, incoming: FlowProject): ImportConflict[];
export declare function mergeProjects(current: FlowProject, incoming: FlowProject, strategy: "rename" | "overwrite"): FlowProject;
