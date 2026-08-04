export type FlowNodeType = "START" | "INPUT" | "SKILL" | "WORKSPACE" | "HTTP" | "CONDITION" | "OUTPUT";
export type WorkspaceConfig = {
    agentSkillId: string;
    skillIds: string[];
    maxIterations: number;
    agentName?: string;
    agentPrompt?: string;
};
export type FlowNode = {
    id: string;
    title: string;
    type: FlowNodeType;
    icon: string;
    x: number;
    y: number;
    tone: string;
    note: string;
    outputVar: string;
    workspace?: WorkspaceConfig;
    config?: Record<string, unknown>;
    timeoutMs?: number;
};
export type Connection = {
    id?: string;
    from: string;
    to: string;
    label?: string;
    condition?: string;
};
export type Variable = {
    name: string;
    type: string;
    defaultValue: string;
};
export type InputComponentType = "input" | "checkbox" | "button";
export type InputComponentSize = "small" | "medium" | "large";
export type InputFormLayout = "single" | "two-column" | "three-column";
export type InputField = {
    id: string;
    variable: string;
    label: string;
    component: InputComponentType;
    size: InputComponentSize;
    placeholder?: string;
    buttonValue?: string;
};
export type InputFormConfig = {
    layout: InputFormLayout;
    fields: InputField[];
};
export type KnowledgeScope = "app" | "session";
export type AppInteractionConfig = {
    conversation?: {
        multiTurn?: boolean;
        history?: boolean;
        historyWindow?: number;
    };
    knowledge?: {
        enabled: true;
        scopes?: KnowledgeScope[];
        topK?: number;
        chunkSize?: number;
        chunkOverlap?: number;
    };
    streaming?: {
        defaultMode: "text" | "events";
    };
};
export type BackgroundTriggerVariables = Record<string, null | boolean | number | string | unknown[] | Record<string, unknown>>;
export type HeartbeatTriggerConfig = {
    id: string;
    everyMs: number;
    input: string;
    variables?: BackgroundTriggerVariables;
    runOnStart?: boolean;
};
export type CronTriggerConfig = {
    id: string;
    expression: string;
    timezone: string;
    input: string;
    variables?: BackgroundTriggerVariables;
    misfireGraceMs?: number;
};
export type AppBackgroundConfig = {
    historyWindow?: number;
    heartbeat?: HeartbeatTriggerConfig;
    cron?: CronTriggerConfig[];
};
export type Skill = {
    id: string;
    name: string;
    description: string;
    category: string;
    prompt: string;
    pluginIds: string[];
};
export type Plugin = {
    id: string;
    name: string;
    description: string;
    version: string;
    sdkVersion: "1";
    language: "typescript";
    entry: "dist/index.js";
    runtime: "player" | "runtime" | "server";
    source: "custom";
    author?: {
        name: string;
        url?: string;
    };
    license?: string;
    homepage?: string;
    permissions: string[];
    tools: Array<{
        name: string;
        description: string;
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
        permissions: string[];
    }>;
    limits?: {
        timeoutMs?: number;
        maxOutputBytes?: number;
        maxConcurrency?: number;
    };
    integrity?: string;
    signature?: {
        algorithm: "Ed25519";
        keyId: string;
        value: string;
    };
    packageJson: string;
    tsconfigJson: string;
    sourceCode: string;
    bundleCode: string;
    readme: string;
};
export type FlowProject = {
    name: string;
    appId?: string;
    appVersion?: string;
    interaction?: AppInteractionConfig;
    background?: AppBackgroundConfig;
    execution?: {
        timeoutMs?: number;
        maxConcurrency?: number;
    };
    flowHookIds?: string[];
    nodes: FlowNode[];
    edges: Connection[];
    skills: Skill[];
    plugins: Plugin[];
    variables: Variable[];
    visualizations: string[];
};
export type EditorDocument = FlowProject & {
    selectedNodeId: string;
    selectedSkillId: string;
};
