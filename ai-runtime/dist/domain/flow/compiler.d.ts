import type { FlowDefinition } from "../../lib/flow-runtime/types.ts";
import type { FlowProject, Plugin, Skill, Variable } from "./types.ts";
export type RunRequest = {
    keyReference: string;
    workspaceId: string;
    model: string;
    flow?: FlowDefinition;
    skill?: SkillPayload;
    workspace?: {
        agentSkill: SkillPayload;
        maxIterations: number;
        skills: SkillPayload[];
    };
    skills?: SkillPayload[];
    variables: Record<string, unknown>;
    temperature: number;
    maxTokens: number;
    stream: true;
    scope: "flow" | "node" | "skill";
    pluginGrants: Record<string, string[]>;
    breakpointNodeIds?: string[];
    resume?: {
        runId: string;
        resumeToken: string;
    };
    inputValues?: Record<string, unknown>;
};
type SkillPayload = Omit<Skill, "prompt" | "pluginIds"> & {
    systemPrompt: string;
    plugins: Array<Pick<Plugin, "id" | "version" | "integrity">>;
};
type CompileConfig = {
    keyReference: string;
    workspaceId?: string;
    model: string;
    input: string;
    variables?: Record<string, unknown>;
    pluginGrants?: Record<string, string[]>;
    breakpointNodeIds?: string[];
};
export declare function parseRuntimeVariable(variable: Variable, value?: unknown): unknown;
export declare function compileRuntimeVariables(project: FlowProject, overrides?: Record<string, unknown>): Record<string, unknown>;
export declare function compileInputValues(project: FlowProject, nodeId: string, values: Record<string, unknown>): {
    [k: string]: unknown;
};
export declare function compileFlow(project: FlowProject): FlowDefinition;
export declare function compileRunRequest(project: FlowProject, config: CompileConfig): RunRequest;
export declare function compileSkillTestRequest(project: FlowProject, skillId: string, config: CompileConfig): RunRequest;
export declare function compileNodeRunRequest(project: FlowProject, nodeId: string, config: CompileConfig): RunRequest;
export {};
