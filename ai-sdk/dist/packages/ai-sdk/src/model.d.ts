import type { FlowNode, FlowProject, InputComponentSize, InputComponentType, InputFormLayout } from "../../../domain/flow/types.ts";
import type { PortablePluginDefinition } from "./plugin.ts";
import { type CodeDefinition, type CodeInput, type CodeValue } from "./code.ts";
import type { WorkspaceHookDefinition } from "./hook.ts";
import type { FlowHookDefinition } from "./flow-hook.ts";
export type { AppInteractionConfig } from "../../../domain/flow/types.ts";
declare const VALUE_REF: unique symbol;
declare const TEMPLATE: unique symbol;
declare const APP: unique symbol;
declare const BRANCH_REF: unique symbol;
export type VariableKind = "string" | "markdown" | "number" | "boolean" | "array" | "object";
export type Visualization = "bar" | "line" | "pie" | "area" | "scatter" | "radar";
export type Position = {
    x: number;
    y: number;
};
export type AiSdkIssue = {
    code: string;
    message: string;
    path?: string;
    nodeId?: string;
};
export declare class AiSdkError extends Error {
    readonly code: string;
    readonly issues: AiSdkIssue[];
    constructor(code: string, message: string, issues?: AiSdkIssue[], options?: ErrorOptions);
}
export type VariableRef<T> = {
    readonly name: string;
    readonly kind: VariableKind;
    readonly defaultValue: T;
    readonly [VALUE_REF]: "variable" | "node";
};
export type NodeRef<T> = VariableRef<T> & {
    readonly id: string;
    readonly nodeId: string;
    readonly [VALUE_REF]: "node";
};
export type ConditionBranchRef = {
    readonly nodeId: string;
    readonly condition: "true" | "false";
    readonly [BRANCH_REF]: true;
};
export type ConditionRef = NodeRef<boolean> & {
    whenTrue(): ConditionBranchRef;
    whenFalse(): ConditionBranchRef;
};
export type Template = {
    readonly text: string;
    readonly [TEMPLATE]: true;
};
type AfterRef = NodeRef<unknown> | ConditionBranchRef;
type After = AfterRef | readonly AfterRef[];
type OutputOption<T> = string | VariableRef<T>;
export type SkillDefinition = {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly category: string;
    readonly prompt: string | Template;
    readonly plugins: readonly PortablePluginDefinition[];
};
export type DefineSkillOptions = {
    id: string;
    name: string;
    description?: string;
    category?: string;
    prompt: string | Template;
    plugins?: readonly PortablePluginDefinition[];
};
type CommonNodeOptions<T> = {
    id: string;
    title?: string;
    output?: OutputOption<T>;
    after?: After;
    position?: Position;
    timeoutMs?: number;
};
export type InputFieldOption<T = unknown> = {
    variable: VariableRef<T>;
    label: string;
    component?: InputComponentType;
    size?: InputComponentSize;
    placeholder?: string;
    buttonValue?: string;
};
export type InputNodeOptions = CommonNodeOptions<Record<string, unknown>> & {
    layout?: InputFormLayout;
    fields: readonly InputFieldOption[];
};
export type SkillNodeOptions<T = string> = CommonNodeOptions<T> & {
    skill: SkillDefinition;
    input?: unknown;
};
export type WorkspaceNodeOptions<T = string> = CommonNodeOptions<T> & {
    agent: SkillDefinition;
    skills: readonly SkillDefinition[];
    hooks?: readonly WorkspaceHookDefinition[];
    input?: unknown;
    maxIterations?: number;
};
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
export type HttpNodeOptions<T = unknown> = CommonNodeOptions<{
    status: number;
    headers: Record<string, string>;
    body: T;
}> & {
    method?: HttpMethod;
    url: unknown;
    headers?: unknown;
    body?: unknown;
};
export type OutputNodeOptions<T = unknown> = CommonNodeOptions<T> & {
    value?: unknown;
};
export type ConditionNodeOptions = CommonNodeOptions<boolean> & {
    expression: string | Template;
};
export type CodeNodeOptions<TInput extends CodeValue, TOutput extends CodeValue> = CommonNodeOptions<TOutput> & {
    code: CodeDefinition<TInput, TOutput>;
    input: CodeInput<TInput>;
};
export type ContactSeverity = "info" | "warning" | "critical";
export type ContactReceipt = {
    id: string;
    status: "queued";
    webhookQueued: boolean;
    createdAt: string;
};
export type ContactNodeOptions = CommonNodeOptions<ContactReceipt> & {
    title: unknown;
    body: unknown;
    severity?: ContactSeverity;
    webhook?: boolean;
    dedupeKey?: unknown;
};
export interface FlowBuilderApi {
    input(options: InputNodeOptions): NodeRef<Record<string, unknown>>;
    skill<T = string>(options: SkillNodeOptions<T>): NodeRef<T>;
    workspace<T = string>(options: WorkspaceNodeOptions<T>): NodeRef<T>;
    http<T = unknown>(options: HttpNodeOptions<T>): NodeRef<{
        status: number;
        headers: Record<string, string>;
        body: T;
    }>;
    condition(options: ConditionNodeOptions): ConditionRef;
    code<TInput extends CodeValue, TOutput extends CodeValue>(options: CodeNodeOptions<TInput, TOutput>): NodeRef<TOutput>;
    contact(options: ContactNodeOptions): NodeRef<ContactReceipt>;
    output<T = unknown>(options: OutputNodeOptions<T>): NodeRef<T>;
}
export type AppBuilderContext = {
    flow: FlowBuilderApi;
};
export type AppInteractionOptions = {
    conversation?: {
        multiTurn?: boolean;
        history?: boolean;
        historyWindow?: number;
    };
    knowledge?: {
        enabled: true;
        scopes?: readonly ("app" | "session")[];
        topK?: number;
        chunkSize?: number;
        chunkOverlap?: number;
    };
    streaming?: {
        defaultMode: "text" | "events";
    };
};
export type BackgroundValue = null | boolean | number | string | BackgroundValue[] | {
    [key: string]: BackgroundValue;
};
export type BackgroundTriggerBase = {
    id: string;
    input: string;
    variables?: Readonly<Record<string, BackgroundValue>>;
};
export type HeartbeatOptions = BackgroundTriggerBase & {
    everyMs: number;
    runOnStart?: boolean;
};
export type CronOptions = BackgroundTriggerBase & {
    expression: string;
    timezone: string;
    misfireGraceMs?: number;
};
export type AppBackgroundOptions = {
    historyWindow?: number;
    heartbeat?: HeartbeatOptions;
    cron?: readonly CronOptions[];
};
export type DefineAppOptions = {
    id?: string;
    version?: string;
    name: string;
    interaction?: AppInteractionOptions;
    background?: AppBackgroundOptions;
    variables?: readonly VariableRef<unknown>[];
    skills?: readonly SkillDefinition[];
    plugins?: readonly PortablePluginDefinition[];
    visualizations?: readonly Visualization[];
    timeoutMs?: number;
    maxConcurrency?: number;
    hooks?: readonly FlowHookDefinition[];
};
export type AppDefinition = {
    readonly id?: string;
    readonly version?: string;
    readonly name: string;
    readonly [APP]: true;
};
export type PreparedApp = {
    project: Omit<FlowProject, "plugins" | "nodes"> & {
        nodes: SdkFlowNode[];
    };
    plugins: PortablePluginDefinition[];
    codes: CodeDefinition[];
    hooks: WorkspaceHookDefinition[];
    flowHooks: FlowHookDefinition[];
};
export type SdkFlowNode = Omit<FlowNode, "type"> & {
    type: FlowNode["type"] | "CODE" | "CONTACT";
};
export declare const variable: {
    string(name: string, defaultValue?: string): VariableRef<string>;
    markdown(name: string, defaultValue?: string): VariableRef<string>;
    number(name: string, defaultValue?: number): VariableRef<number>;
    boolean(name: string, defaultValue?: boolean): VariableRef<boolean>;
    array<T extends unknown[]>(name: string, defaultValue?: T): VariableRef<T>;
    object<T extends Record<string, unknown>>(name: string, defaultValue?: T): VariableRef<T>;
};
export declare function template(strings: TemplateStringsArray, ...values: unknown[]): Template;
export declare function defineSkill(options: DefineSkillOptions): SkillDefinition;
export declare function defineApp(options: DefineAppOptions, build: (context: AppBuilderContext) => void): AppDefinition;
export declare function preparedApp(app: AppDefinition): PreparedApp;
