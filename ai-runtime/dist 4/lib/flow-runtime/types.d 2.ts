export type FlowNodeType = "START" | "INPUT" | "SKILL" | "WORKSPACE" | "HTTP" | "CONDITION" | "OUTPUT";
export type ErrorStrategy = "stop" | "continue" | "skip";
export type RetryPolicy = {
    maxAttempts?: number;
    delayMs?: number;
    backoff?: "fixed" | "exponential";
    retryOn?: Array<"timeout" | "network" | "execution">;
};
export type FlowNode = {
    id: string;
    type: FlowNodeType;
    title?: string;
    outputVar?: string;
    timeoutMs?: number;
    retry?: RetryPolicy;
    onError?: ErrorStrategy;
    fallbackValue?: unknown;
    config?: Record<string, unknown>;
};
export type FlowEdge = {
    id?: string;
    from: string;
    to: string;
    condition?: string;
    label?: string;
};
export type LoopPolicy = {
    enabled: true;
    maxIterations: number;
    maxNodeExecutions?: number;
};
export type FlowConfig = {
    timeoutMs?: number;
    maxConcurrency?: number;
    onError?: ErrorStrategy;
    retry?: RetryPolicy;
    loop?: LoopPolicy;
};
export type FlowDefinition = {
    entry?: string;
    nodes: FlowNode[];
    edges: FlowEdge[];
    config?: FlowConfig;
};
export type ValidationCode = "DUPLICATE_NODE_ID" | "DUPLICATE_EDGE_ID" | "ENTRY_MISSING" | "ENTRY_INVALID" | "START_COUNT" | "DANGLING_EDGE" | "CYCLE" | "UNREACHABLE_NODE" | "INVALID_CONDITION" | "INVALID_NODE" | "OUTPUT_MISSING";
export type ValidationIssue = {
    code: ValidationCode;
    message: string;
    severity: "error" | "warning";
    nodeId?: string;
    edgeId?: string;
};
export type ValidationResult = {
    valid: boolean;
    issues: ValidationIssue[];
    entry?: string;
    reachableNodeIds: string[];
    cycleNodeIds: string[];
};
export type ExecutionPlan = {
    mode: "dag";
    entry: string;
    layers: string[][];
} | {
    mode: "controlled-loop";
    entry: string;
    maxIterations: number;
    maxNodeExecutions: number;
};
export type NodeExecutionStatus = "success" | "skipped" | "failed";
export type NodeExecutionRecord = {
    nodeId: string;
    status: NodeExecutionStatus;
    attempts: number;
    startedAt: number;
    endedAt: number;
    output?: unknown;
    error?: string;
};
export type FlowEvent = {
    type: "flow:start";
    at: number;
} | {
    type: "flow:resume";
    at: number;
    nodeId: string;
} | {
    type: "flow:pause";
    at: number;
    nodeId: string;
} | {
    type: "flow:complete";
    at: number;
} | {
    type: "flow:error";
    at: number;
    error: string;
} | {
    type: "node:start";
    at: number;
    nodeId: string;
    attempt: number;
} | {
    type: "node:complete";
    at: number;
    nodeId: string;
    attempt: number;
    output: unknown;
} | {
    type: "node:retry";
    at: number;
    nodeId: string;
    attempt: number;
    error: string;
} | {
    type: "node:skip";
    at: number;
    nodeId: string;
    error: string;
};
export type SkillInvocation = {
    skillId: string;
    input: unknown;
    variables: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
    node: FlowNode;
};
export type WorkspaceInvocation = {
    agentSkillId: string;
    skillIds: string[];
    maxIterations: number;
    input: unknown;
    variables: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
    node: FlowNode;
};
export type RuntimeServices = {
    runSkill?: (invocation: SkillInvocation) => Promise<unknown>;
    runWorkspace?: (invocation: WorkspaceInvocation) => Promise<unknown>;
    fetch?: typeof globalThis.fetch;
    allowHttpUrl?: (url: URL, node: FlowNode) => boolean | Promise<boolean>;
    renderValue?: (value: unknown, variables: Readonly<Record<string, unknown>>) => unknown;
};
export type NodeResult = {
    output?: unknown;
    selectedEdgeIds?: string[];
    metadata?: Record<string, unknown>;
};
export type NodeExecutionContext = {
    variables: Readonly<Record<string, unknown>>;
    inputs: unknown[];
    previous?: unknown;
    signal: AbortSignal;
    outgoingEdges: ReadonlyArray<FlowEdge & {
        id: string;
    }>;
    services: RuntimeServices;
};
export type BeforeNodeHookEvent = {
    node: Readonly<FlowNode>;
    attempt: number;
    variables: Readonly<Record<string, unknown>>;
    inputs: readonly unknown[];
    signal: AbortSignal;
};
export type BeforeNodeHookResult = {
    config?: Record<string, unknown>;
    skip?: boolean;
    output?: unknown;
};
export type AfterNodeHookEvent = BeforeNodeHookEvent & {
    output: unknown;
    skipped: boolean;
    recovered: boolean;
};
export type NodeErrorHookEvent = Omit<BeforeNodeHookEvent, "attempt"> & {
    attempts: number;
    error: Error;
};
export type NodeErrorHookResult = {
    recover?: boolean;
    output?: unknown;
};
export type FlowNodeHooks = {
    beforeNode?: (event: BeforeNodeHookEvent) => Promise<BeforeNodeHookResult | void> | BeforeNodeHookResult | void;
    afterNode?: (event: AfterNodeHookEvent) => Promise<unknown> | unknown;
    onNodeError?: (event: NodeErrorHookEvent) => Promise<NodeErrorHookResult | void> | NodeErrorHookResult | void;
};
export interface NodeExecutor {
    execute(node: FlowNode, context: NodeExecutionContext): Promise<NodeResult>;
}
export type ExecutorRegistry = Partial<Record<FlowNodeType, NodeExecutor>>;
export type FlowCheckpoint = {
    version: 1;
    cursor: {
        mode: "dag";
        layerIndex: number;
    } | {
        mode: "controlled-loop";
        iteration: number;
        executionCounts: Record<string, number>;
    };
    variables: Record<string, unknown>;
    outputs: Record<string, unknown>;
    records: NodeExecutionRecord[];
    activeNodeIds: string[];
    readyNodeIds: string[];
    approvedBreakpointNodeIds: string[];
    pausedBeforeNodeId: string;
    startedAt: number;
};
export type RunOptions = {
    variables?: Record<string, unknown>;
    input?: unknown;
    signal?: AbortSignal;
    services?: RuntimeServices;
    executors?: ExecutorRegistry;
    onEvent?: (event: FlowEvent) => void;
    hooks?: FlowNodeHooks;
    breakpointNodeIds?: string[];
    resumeFrom?: FlowCheckpoint;
};
export type FlowRunResult = {
    output: unknown;
    outputs: Record<string, unknown>;
    variables: Record<string, unknown>;
    records: NodeExecutionRecord[];
    plan: ExecutionPlan;
    startedAt: number;
    endedAt: number;
    status: "completed" | "paused";
    checkpoint?: FlowCheckpoint;
};
export declare class FlowValidationError extends Error {
    readonly validation: ValidationResult;
    constructor(validation: ValidationResult);
}
export declare class FlowExecutionError extends Error {
    readonly nodeId?: string;
    constructor(message: string, nodeId?: string, options?: ErrorOptions);
}
export declare class FlowCancelledError extends FlowExecutionError {
    constructor(message?: string, nodeId?: string);
}
export declare class FlowTimeoutError extends FlowExecutionError {
    constructor(message?: string, nodeId?: string);
}
export declare class FlowHookExecutionError extends FlowExecutionError {
    readonly code = "FLOW_HOOK_FAILED";
    readonly stage: "beforeNode" | "afterNode" | "onNodeError";
    constructor(stage: "beforeNode" | "afterNode" | "onNodeError", nodeId: string, options?: ErrorOptions);
}
