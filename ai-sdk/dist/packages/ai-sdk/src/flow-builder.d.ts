import type { AppInteractionConfig, FlowProject } from "../../../domain/flow/types.ts";
import { type CodeDefinition, type CodeValue } from "./code.ts";
import type { WorkspaceHookDefinition } from "./hook.ts";
import type { CodeNodeOptions, ConditionNodeOptions, ConditionRef, ContactNodeOptions, ContactReceipt, FlowBuilderApi, FlowFinishIdentity, HttpNodeOptions, InputNodeOptions, NodeRef, OutputNodeOptions, PreparedApp, SkillDefinition, SkillNodeOptions, VariableRef, Visualization, WorkspaceNodeOptions } from "./model-types.ts";
export declare class FlowBuilder implements FlowBuilderApi {
    private readonly graph;
    private readonly skillIds;
    private readonly codeDefinitions;
    private readonly hookDefinitions;
    constructor(initial: readonly VariableRef<unknown>[], skills: readonly SkillDefinition[]);
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
    finish(name: string, skills: readonly SkillDefinition[], visualizations: readonly Visualization[], interaction?: AppInteractionConfig, identity?: FlowFinishIdentity, execution?: FlowProject["execution"]): PreparedApp["project"];
    codes(): CodeDefinition[];
    hooks(): WorkspaceHookDefinition[];
}
