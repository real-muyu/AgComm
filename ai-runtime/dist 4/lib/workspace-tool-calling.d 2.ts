export type WorkspaceToolSkill = {
    id?: string;
    name?: string;
    description?: string;
    category?: string;
};
export type WorkspaceToolCall = {
    id?: string;
    name: string;
    args?: unknown;
};
export type WorkspaceAgentReply = {
    content?: unknown;
    toolCalls?: WorkspaceToolCall[];
    raw?: unknown;
};
export type WorkspaceToolTrace = {
    skillId: string;
    skillName: string;
    input: string;
    output: string;
    kind?: "skill" | "plugin";
};
export type WorkspaceToolEvent = {
    call: WorkspaceToolCall;
    toolId: string;
    toolName: string;
    kind: "skill" | "plugin";
    input: string;
};
export type WorkspaceToolBeforeResult = {
    input?: unknown;
    skipWith?: string;
} | void;
export type WorkspaceToolAfterResult = {
    output?: string;
} | void;
export type WorkspaceToolDefinition = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};
export type WorkspaceExtraTool = {
    id: string;
    label: string;
    name: string;
    tool: WorkspaceToolDefinition;
    call(args: Record<string, unknown>): Promise<unknown>;
};
export declare function contentToText(content: unknown): string;
export declare function workspaceToolName(id: string, index: number): string;
export declare function createWorkspaceToolDefinitions<T extends WorkspaceToolSkill>(skills: T[]): {
    skill: T;
    name: string;
    tool: WorkspaceToolDefinition;
}[];
export declare function runWorkspaceToolCalling<T extends WorkspaceToolSkill>(options: {
    skills: T[];
    input: string;
    maxIterations: number;
    initialMessages?: unknown[];
    callAgent: (messages: unknown[], tools: WorkspaceToolDefinition[], forceFinal: boolean) => Promise<WorkspaceAgentReply>;
    callSkill: (skill: T, input: string) => Promise<unknown>;
    createToolMessage?: (call: WorkspaceToolCall, output: string) => unknown;
    signal?: AbortSignal;
    maxToolCalls?: number;
    maxParallelToolCalls?: number;
    serializeToolOutput?: (skill: T, output: string) => string;
    serializeExtraToolOutput?: (tool: WorkspaceExtraTool, output: string) => string;
    extraTools?: WorkspaceExtraTool[];
    onToolCall?: (event: WorkspaceToolEvent) => void;
    onToolResult?: (event: WorkspaceToolEvent & {
        output: string;
    }) => void;
    beforeTool?: (event: WorkspaceToolEvent & {
        rawInput: unknown;
    }) => Promise<WorkspaceToolBeforeResult> | WorkspaceToolBeforeResult;
    afterTool?: (event: WorkspaceToolEvent & {
        rawInput: unknown;
        output: string;
        skipped: boolean;
    }) => Promise<WorkspaceToolAfterResult> | WorkspaceToolAfterResult;
    forceFinalOnNoToolCalls?: boolean;
}): Promise<{
    output: string;
    toolCalls: WorkspaceToolTrace[];
    messages: unknown[];
    iterations: number;
    finalReply: WorkspaceAgentReply;
}>;
