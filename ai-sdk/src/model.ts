import { autoLayoutNodes, createConnection } from "../../../domain/flow/editor.ts";
import { assertTimeZone, nextCronOccurrence, parseCronExpression } from "./background-schedule.ts";
import { validateExpression } from "../../../lib/flow-runtime/expression.ts";
import type {
  AppInteractionConfig,
  AppBackgroundConfig,
  FlowNode,
  FlowProject,
  InputComponentSize,
  InputComponentType,
  InputFormLayout,
  Variable,
} from "../../../domain/flow/types.ts";
import type { PortablePluginDefinition } from "./plugin.ts";
import { outputKindForCode, type CodeDefinition, type CodeInput, type CodeValue } from "./code.ts";
import type { WorkspaceHookDefinition } from "./hook.ts";
import type { FlowHookDefinition } from "./flow-hook.ts";
export type { AppInteractionConfig } from "../../../domain/flow/types.ts";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const VALUE_REF = Symbol("agcomm.ai-sdk.value-ref");
const TEMPLATE = Symbol("agcomm.ai-sdk.template");
const APP = Symbol("agcomm.ai-sdk.app");
const BRANCH_REF = Symbol("agcomm.ai-sdk.branch-ref");
const RESERVED_VARIABLES = new Set(["session_id", "conversation_history", "knowledge_context", "background_trigger", "gateway_run_id"]);

export type VariableKind = "string" | "markdown" | "number" | "boolean" | "array" | "object";
export type Visualization = "bar" | "line" | "pie" | "area" | "scatter" | "radar";
export type Position = { x: number; y: number };

export type AiSdkIssue = {
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
};

export class AiSdkError extends Error {
  readonly code: string;
  readonly issues: AiSdkIssue[];

  constructor(code: string, message: string, issues: AiSdkIssue[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = "AiSdkError";
    this.code = code;
    this.issues = issues;
  }
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

export type HttpNodeOptions<T = unknown> = CommonNodeOptions<{ status: number; headers: Record<string, string>; body: T }> & {
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
export type ContactReceipt = { id: string; status: "queued"; webhookQueued: boolean; createdAt: string };
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
  http<T = unknown>(options: HttpNodeOptions<T>): NodeRef<{ status: number; headers: Record<string, string>; body: T }>;
  condition(options: ConditionNodeOptions): ConditionRef;
  code<TInput extends CodeValue, TOutput extends CodeValue>(options: CodeNodeOptions<TInput, TOutput>): NodeRef<TOutput>;
  contact(options: ContactNodeOptions): NodeRef<ContactReceipt>;
  output<T = unknown>(options: OutputNodeOptions<T>): NodeRef<T>;
}

export type AppBuilderContext = { flow: FlowBuilderApi };

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

export type BackgroundValue = null | boolean | number | string | BackgroundValue[] | { [key: string]: BackgroundValue };
export type BackgroundTriggerBase = { id: string; input: string; variables?: Readonly<Record<string, BackgroundValue>> };
export type HeartbeatOptions = BackgroundTriggerBase & { everyMs: number; runOnStart?: boolean };
export type CronOptions = BackgroundTriggerBase & { expression: string; timezone: string; misfireGraceMs?: number };
export type AppBackgroundOptions = { historyWindow?: number; heartbeat?: HeartbeatOptions; cron?: readonly CronOptions[] };

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
  project: Omit<FlowProject, "plugins" | "nodes"> & { nodes: SdkFlowNode[] };
  plugins: PortablePluginDefinition[];
  codes: CodeDefinition[];
  hooks: WorkspaceHookDefinition[];
  flowHooks: FlowHookDefinition[];
};

export type SdkFlowNode = Omit<FlowNode, "type"> & { type: FlowNode["type"] | "CODE" | "CONTACT" };

type InternalApp = AppDefinition & { prepared: PreparedApp };

function fail(code: string, message: string, issue: Omit<AiSdkIssue, "code" | "message"> = {}): never {
  throw new AiSdkError(code, message, [{ code, message, ...issue }]);
}

function assertId(id: string, subject: string) {
  if (!ID_PATTERN.test(id)) fail("INVALID_ID", `${subject} ID “${id}” 无效`, { path: subject });
}

function defaultFor(kind: VariableKind): unknown {
  if (kind === "number") return 0;
  if (kind === "boolean") return false;
  if (kind === "array") return [];
  if (kind === "object") return {};
  return "";
}

function variableRef<T>(kind: VariableKind, name: string, value: T): VariableRef<T> {
  if (!VARIABLE_PATTERN.test(name)) fail("INVALID_VARIABLE", `变量名“${name}”无效`, { path: name });
  return Object.freeze({ name, kind, defaultValue: value, [VALUE_REF]: "variable" as const });
}

export const variable = {
  string(name: string, defaultValue = "") { return variableRef("string", name, defaultValue); },
  markdown(name: string, defaultValue = "") { return variableRef("markdown", name, defaultValue); },
  number(name: string, defaultValue = 0) { return variableRef("number", name, defaultValue); },
  boolean(name: string, defaultValue = false) { return variableRef("boolean", name, defaultValue); },
  array<T extends unknown[]>(name: string, defaultValue = [] as unknown as T) { return variableRef("array", name, defaultValue); },
  object<T extends Record<string, unknown>>(name: string, defaultValue = {} as T) { return variableRef("object", name, defaultValue); },
};

function isValueRef(value: unknown): value is VariableRef<unknown> | NodeRef<unknown> {
  return Boolean(value && typeof value === "object" && VALUE_REF in value);
}

function isNodeRef(value: unknown): value is NodeRef<unknown> {
  return isValueRef(value) && value[VALUE_REF] === "node";
}

function isBranchRef(value: unknown): value is ConditionBranchRef {
  return Boolean(value && typeof value === "object" && BRANCH_REF in value);
}

function isTemplate(value: unknown): value is Template {
  return Boolean(value && typeof value === "object" && TEMPLATE in value);
}

export function template(strings: TemplateStringsArray, ...values: unknown[]): Template {
  let text = strings[0] ?? "";
  values.forEach((value, index) => {
    if (isValueRef(value)) text += `{{${value.name}}}`;
    else if (isTemplate(value)) text += value.text;
    else text += String(value ?? "");
    text += strings[index + 1] ?? "";
  });
  return Object.freeze({ text, [TEMPLATE]: true as const });
}

export function defineSkill(options: DefineSkillOptions): SkillDefinition {
  assertId(options.id, "Skill");
  if (!options.name.trim()) fail("INVALID_SKILL", `Skill “${options.id}” 缺少名称`);
  return Object.freeze({
    id: options.id,
    name: options.name,
    description: options.description ?? "",
    category: options.category ?? "未分类",
    prompt: options.prompt,
    plugins: [...(options.plugins ?? [])],
  });
}

function encodeDefault(ref: VariableRef<unknown>) {
  if (ref.kind === "array" || ref.kind === "object") {
    try { return JSON.stringify(ref.defaultValue); }
    catch (error) { throw new AiSdkError("INVALID_VARIABLE_DEFAULT", `变量“${ref.name}”的默认值无法序列化`, [], { cause: error }); }
  }
  return String(ref.defaultValue ?? "");
}

function serializeValue(value: unknown): unknown {
  if (isValueRef(value)) return `{{${value.name}}}`;
  if (isTemplate(value)) return value.text;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]));
  return value;
}

const REFERENCE_PATTERN = /\{\{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\}\}/g;

function collectReferenceNames(value: unknown, names = new Set<string>()) {
  const serialized = serializeValue(value);
  if (typeof serialized === "string") {
    for (const match of serialized.matchAll(REFERENCE_PATTERN)) names.add(match[1].split(".")[0]);
  } else if (Array.isArray(serialized)) {
    for (const item of serialized) collectReferenceNames(item, names);
  } else if (serialized && typeof serialized === "object") {
    for (const item of Object.values(serialized)) collectReferenceNames(item, names);
  }
  return names;
}

function inferredKind(value: unknown): VariableKind {
  if (isValueRef(value)) return value.kind;
  if (isTemplate(value) || typeof value === "string") return "markdown";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return "object";
  return "markdown";
}

function nodeDefaults(type: SdkFlowNode["type"]) {
  if (type === "INPUT") return { title: "用户输入", icon: "⌨", tone: "blue", note: "收集运行变量" };
  if (type === "SKILL") return { title: "调用 Skill", icon: "✦", tone: "violet", note: "调用 Skill" };
  if (type === "WORKSPACE") return { title: "Agent Workspace", icon: "◎", tone: "cyan", note: "Agent 自主调用 Skills" };
  if (type === "HTTP") return { title: "HTTP 请求", icon: "⌁", tone: "slate", note: "发送 HTTPS 请求" };
  if (type === "CONDITION") return { title: "条件分支", icon: "◇", tone: "amber", note: "运行时条件判断" };
  if (type === "CODE") return { title: "TypeScript 代码", icon: "{ }", tone: "slate", note: "执行确定性代码" };
  if (type === "CONTACT") return { title: "联系用户", icon: "@", tone: "cyan", note: "写入 Inbox 并投递通知" };
  if (type === "OUTPUT") return { title: "输出", icon: "↗", tone: "green", note: "返回运行结果" };
  return { title: "开始", icon: "▶", tone: "mint", note: "流程入口" };
}

class FlowBuilder implements FlowBuilderApi {
  private readonly builderId = crypto.randomUUID();
  private readonly nodes: SdkFlowNode[] = [];
  private readonly edges: FlowProject["edges"] = [];
  private readonly variables = new Map<string, VariableRef<unknown>>();
  private readonly variableProducers = new Map<string, string>();
  private readonly explicitPositions = new Map<string, Position>();
  private readonly skillIds: Set<string>;
  private readonly branchConsumers = new Map<string, string>();
  private readonly codeDefinitions = new Map<string, CodeDefinition>();
  private readonly hookDefinitions = new Map<string, WorkspaceHookDefinition>();
  private lastNodeId = "start";

  constructor(initialVariables: readonly VariableRef<unknown>[], skills: readonly SkillDefinition[]) {
    this.skillIds = new Set(skills.map((skill) => skill.id));
    for (const ref of initialVariables) this.registerVariable(ref);
    const defaults = nodeDefaults("START");
    this.nodes.push({ id: "start", title: defaults.title, type: "START", icon: defaults.icon, x: 24, y: 180, tone: defaults.tone, note: defaults.note, outputVar: "" });
  }

  private registerVariable(ref: VariableRef<unknown>) {
    const current = this.variables.get(ref.name);
    if (current && (current.kind !== ref.kind || encodeDefault(current) !== encodeDefault(ref))) {
      fail("DUPLICATE_VARIABLE", `变量“${ref.name}”使用了冲突的类型或默认值`, { path: ref.name });
    }
    if (!current) this.variables.set(ref.name, ref);
  }

  private registerValueRefs(value: unknown) {
    if (isValueRef(value)) { this.registerVariable(value); return; }
    if (Array.isArray(value)) { value.forEach((item) => this.registerValueRefs(item)); return; }
    if (value && typeof value === "object" && !isTemplate(value)) Object.values(value).forEach((item) => this.registerValueRefs(item));
  }

  private outputRef<T>(nodeId: string, option: OutputOption<T> | undefined, kind: VariableKind): NodeRef<T> {
    const existing = typeof option === "string" ? this.variables.get(option) : option;
    const name = typeof option === "string" ? option : option?.name ?? `${nodeId}_output`;
    if (RESERVED_VARIABLES.has(name)) fail("RESERVED_VARIABLE", `节点“${nodeId}”不能写入 runtime 保留变量“${name}”`, { nodeId });
    const ref = existing ?? variableRef(kind, name, defaultFor(kind) as T);
    this.registerVariable(ref);
    const producer = this.variableProducers.get(name);
    if (producer && producer !== nodeId) fail("DUPLICATE_OUTPUT", `输出变量“${name}”已由节点“${producer}”写入`, { nodeId });
    this.variableProducers.set(name, nodeId);
    return Object.freeze({ ...ref, id: nodeId, nodeId, [VALUE_REF]: "node" as const, __builderId: this.builderId }) as NodeRef<T>;
  }

  private resolveDependencies(source: unknown, after: After | undefined, nodeId: string) {
    this.registerValueRefs(source);
    const dependencies = new Map<string, "true" | "false" | undefined>();
    for (const name of collectReferenceNames(source)) {
      const producer = this.variableProducers.get(name);
      if (producer) dependencies.set(producer, undefined);
    }
    if (after !== undefined) {
      const refs = Array.isArray(after) ? after : [after];
      for (const ref of refs) {
        if (isBranchRef(ref)) {
          const sourceNode = this.nodes.find((node) => node.id === ref.nodeId);
          if (sourceNode?.type !== "CONDITION") fail("INVALID_DEPENDENCY", `节点“${nodeId}”引用了无效的条件分支`, { nodeId });
          const key = `${ref.nodeId}:${ref.condition}`;
          const consumer = this.branchConsumers.get(key);
          if (consumer && consumer !== nodeId) fail("DUPLICATE_BRANCH_CONSUMER", `条件节点“${ref.nodeId}”的 ${ref.condition} 分支已连接节点“${consumer}”`, { nodeId });
          this.branchConsumers.set(key, nodeId);
          dependencies.set(ref.nodeId, ref.condition);
          continue;
        }
        if (!isNodeRef(ref) || !this.nodes.some((node) => node.id === ref.nodeId)) fail("INVALID_DEPENDENCY", `节点“${nodeId}”引用了其他流程或尚未创建的依赖`, { nodeId });
        if (this.nodes.find((node) => node.id === ref.nodeId)?.type === "CONDITION") fail("CONDITION_BRANCH_REQUIRED", `节点“${nodeId}”必须通过 whenTrue() 或 whenFalse() 连接条件节点`, { nodeId });
        dependencies.set(ref.nodeId, dependencies.get(ref.nodeId));
      }
      if (!dependencies.size) dependencies.set("start", undefined);
    } else if (!dependencies.size) dependencies.set(this.lastNodeId, undefined);
    dependencies.delete(nodeId);
    return [...dependencies].map(([from, condition]) => ({ from, condition }));
  }

  private addNode<T>(
    type: Exclude<SdkFlowNode["type"], "START">,
    options: CommonNodeOptions<T>,
    config: Record<string, unknown>,
    source: unknown,
    kind: VariableKind,
    details: { note?: string; workspace?: FlowNode["workspace"] } = {},
  ) {
    assertId(options.id, "Node");
    if (options.id === "start" || this.nodes.some((node) => node.id === options.id)) fail("DUPLICATE_NODE", `节点 ID “${options.id}” 重复`, { nodeId: options.id });
    const dependencies = this.resolveDependencies(source, options.after, options.id);
    const output = this.outputRef(options.id, options.output, kind);
    const defaults = nodeDefaults(type);
    this.nodes.push({
      id: options.id,
      title: options.title?.trim() || defaults.title,
      type,
      icon: defaults.icon,
      x: options.position?.x ?? 0,
      y: options.position?.y ?? 0,
      tone: defaults.tone,
      note: details.note ?? defaults.note,
      outputVar: output.name,
      config,
      ...(options.timeoutMs !== undefined ? { timeoutMs: executionLimit(options.timeoutMs, 600_000, `节点“${options.id}”的 timeoutMs`) } : {}),
      ...(details.workspace ? { workspace: details.workspace } : {}),
    });
    if (options.position) this.explicitPositions.set(options.id, options.position);
    for (const dependency of dependencies) {
      const edge = createConnection(dependency.from, options.id, this.edges);
      this.edges.push(dependency.condition ? { ...edge, label: dependency.condition, condition: dependency.condition } : edge);
    }
    this.lastNodeId = options.id;
    return output;
  }

  input(options: InputNodeOptions) {
    if (!options.fields.length) fail("INVALID_INPUT", `输入节点“${options.id}”至少需要一个字段`, { nodeId: options.id });
    const seen = new Set<string>();
    for (const field of options.fields) {
      this.registerVariable(field.variable);
      if (seen.has(field.variable.name)) fail("INVALID_INPUT", `输入节点“${options.id}”重复使用变量“${field.variable.name}”`, { nodeId: options.id });
      seen.add(field.variable.name);
    }
    const fields = options.fields.map((field, index) => ({
      id: `field_${field.variable.name}_${index}`,
      variable: field.variable.name,
      label: field.label,
      component: field.component ?? (field.variable.kind === "boolean" ? "checkbox" : "input"),
      size: field.size ?? (field.variable.kind === "boolean" ? "small" : "large"),
      ...(field.placeholder !== undefined ? { placeholder: field.placeholder } : {}),
      ...(field.buttonValue !== undefined ? { buttonValue: field.buttonValue } : {}),
    }));
    const result = this.addNode("INPUT", options, { layout: options.layout ?? "single", fields }, [], "object", { note: [...seen].join(", ") });
    for (const name of seen) this.variableProducers.set(name, options.id);
    return result;
  }

  skill<T = string>(options: SkillNodeOptions<T>) {
    if (!this.skillIds.has(options.skill.id)) fail("MISSING_SKILL", `节点“${options.id}”使用了未在 App 中声明的 Skill “${options.skill.id}”`, { nodeId: options.id });
    const input = options.input ?? "{{user_input}}";
    return this.addNode("SKILL", options, { skillId: options.skill.id, input: serializeValue(input) }, input, "markdown", { note: options.skill.id });
  }

  workspace<T = string>(options: WorkspaceNodeOptions<T>) {
    if (!this.skillIds.has(options.agent.id)) fail("MISSING_SKILL", `Workspace“${options.id}”的总 Agent Skill 未在 App 中声明`, { nodeId: options.id });
    if (!options.skills.length) fail("INVALID_WORKSPACE", `Workspace“${options.id}”至少需要一个可调用 Skill`, { nodeId: options.id });
    if (options.skills.some((skill) => skill.id === options.agent.id)) fail("INVALID_WORKSPACE", `Workspace“${options.id}”不能把总 Agent 同时设为可调用 Skill`, { nodeId: options.id });
    for (const skill of options.skills) if (!this.skillIds.has(skill.id)) fail("MISSING_SKILL", `Workspace“${options.id}”使用了未声明的 Skill “${skill.id}”`, { nodeId: options.id });
    const maxIterations = options.maxIterations ?? 6;
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) fail("INVALID_WORKSPACE", `Workspace“${options.id}”的 maxIterations 必须为 1–10`, { nodeId: options.id });
    const hooks = [...(options.hooks ?? [])];
    if (hooks.length > 16) fail("INVALID_WORKSPACE_HOOKS", `Workspace“${options.id}”最多声明 16 个 Hook`, { nodeId: options.id });
    const hookIds = new Set<string>();
    for (const hook of hooks) {
      if (hookIds.has(hook.id)) fail("DUPLICATE_WORKSPACE_HOOK", `Workspace“${options.id}”重复声明 Hook “${hook.id}”`, { nodeId: options.id });
      hookIds.add(hook.id);
      const current = this.hookDefinitions.get(hook.id);
      if (current && current !== hook) fail("DUPLICATE_WORKSPACE_HOOK", `Hook ID “${hook.id}”引用了不同定义`, { nodeId: options.id });
      this.hookDefinitions.set(hook.id, hook);
    }
    const input = options.input ?? "{{user_input}}";
    const workspace = { agentSkillId: options.agent.id, skillIds: options.skills.map((skill) => skill.id), maxIterations };
    return this.addNode("WORKSPACE", options, { ...workspace, input: serializeValue(input), ...(hooks.length ? { hookIds: hooks.map((hook) => hook.id) } : {}) }, input, "markdown", { workspace, note: `${options.agent.id} · ${options.skills.length} Skills` });
  }

  http<T = unknown>(options: HttpNodeOptions<T>) {
    const source = { url: options.url, headers: options.headers, body: options.body };
    return this.addNode("HTTP", options, {
      method: options.method ?? "GET",
      url: serializeValue(options.url),
      ...(options.headers === undefined ? {} : { headers: serializeValue(options.headers) }),
      ...(options.body === undefined ? {} : { body: serializeValue(options.body) }),
    }, source, "object");
  }

  condition(options: ConditionNodeOptions): ConditionRef {
    const expression = String(serializeValue(options.expression));
    const error = validateExpression(expression);
    if (error) fail("INVALID_CONDITION", `条件节点“${options.id}”表达式无效：${error}`, { nodeId: options.id });
    const output = this.addNode("CONDITION", options, { expression }, options.expression, "boolean");
    const branch = (condition: "true" | "false"): ConditionBranchRef => Object.freeze({
      nodeId: output.nodeId,
      condition,
      [BRANCH_REF]: true as const,
    });
    return Object.freeze({ ...output, whenTrue: () => branch("true"), whenFalse: () => branch("false") }) as ConditionRef;
  }

  code<TInput extends CodeValue, TOutput extends CodeValue>(options: CodeNodeOptions<TInput, TOutput>): NodeRef<TOutput> {
    const current = this.codeDefinitions.get(options.code.id);
    if (current && current !== options.code) fail("DUPLICATE_CODE", `Code ID “${options.code.id}”引用了不同定义`, { path: options.code.id });
    this.codeDefinitions.set(options.code.id, options.code as CodeDefinition);
    return this.addNode("CODE", options, { codeId: options.code.id, input: serializeValue(options.input) }, options.input, outputKindForCode(options.code.outputSchema), { note: options.code.id });
  }

  contact(options: ContactNodeOptions): NodeRef<ContactReceipt> {
    const source = { title: options.title, body: options.body, dedupeKey: options.dedupeKey };
    return this.addNode("CONTACT", options, {
      title: serializeValue(options.title),
      body: serializeValue(options.body),
      severity: options.severity ?? "info",
      webhook: options.webhook === true,
      ...(options.dedupeKey === undefined ? {} : { dedupeKey: serializeValue(options.dedupeKey) }),
    }, source, "object");
  }

  output<T = unknown>(options: OutputNodeOptions<T>) {
    const value = options.value ?? template`{{previous.output}}`;
    return this.addNode("OUTPUT", options, { template: serializeValue(value) }, value, inferredKind(value));
  }

  finish(
    name: string,
    skills: readonly SkillDefinition[],
    visualizations: readonly Visualization[],
    interaction?: AppInteractionConfig,
    identity?: { id?: string; version?: string; background?: AppBackgroundConfig },
    execution?: FlowProject["execution"],
  ): PreparedApp["project"] {
    const layout = autoLayoutNodes(this.nodes as FlowNode[], this.edges).map((node) => {
      const position = this.explicitPositions.get(node.id);
      return position ? { ...node, ...position } : node;
    });
    return {
      name,
      ...(identity?.id ? { appId: identity.id } : {}),
      ...(identity?.version ? { appVersion: identity.version } : {}),
      ...(interaction ? { interaction } : {}),
      ...(identity?.background ? { background: identity.background } : {}),
      ...(execution ? { execution } : {}),
      nodes: layout as SdkFlowNode[],
      edges: this.edges,
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        prompt: isTemplate(skill.prompt) ? skill.prompt.text : skill.prompt,
        pluginIds: skill.plugins.map((plugin) => plugin.id),
      })),
      variables: [...this.variables.values()].map((ref): Variable => ({ name: ref.name, type: ref.kind, defaultValue: encodeDefault(ref) })),
      visualizations: [...visualizations],
    };
  }

  codes() { return [...this.codeDefinitions.values()]; }
  hooks() { return [...this.hookDefinitions.values()]; }
}

function uniqueById<T extends { id: string }>(values: readonly T[], subject: string) {
  const seen = new Set<string>();
  for (const value of values) {
    assertId(value.id, subject);
    if (seen.has(value.id)) fail(`DUPLICATE_${subject.toUpperCase()}`, `${subject} ID “${value.id}” 重复`, { path: value.id });
    seen.add(value.id);
  }
}

export function defineApp(options: DefineAppOptions, build: (context: AppBuilderContext) => void): AppDefinition {
  if (!options.name.trim()) fail("INVALID_APP", "App 名称不能为空");
  const background = normalizeBackground(options.background, options.id, options.version);
  for (const ref of options.variables ?? []) if (RESERVED_VARIABLES.has(ref.name)) fail("RESERVED_VARIABLE", `变量“${ref.name}”由 runtime 保留，不能自行声明`, { path: ref.name });
  const interaction = normalizeInteraction(options.interaction);
  const execution = options.timeoutMs !== undefined || options.maxConcurrency !== undefined ? {
    ...(options.timeoutMs !== undefined ? { timeoutMs: executionLimit(options.timeoutMs, 600_000, "App timeoutMs") } : {}),
    ...(options.maxConcurrency !== undefined ? { maxConcurrency: executionLimit(options.maxConcurrency, 32, "App maxConcurrency") } : {}),
  } : undefined;
  const skills = [...(options.skills ?? [])];
  uniqueById(skills, "skill");
  const flowHooks = [...(options.hooks ?? [])];
  const flowHookIds = new Set<string>();
  for (const hook of flowHooks) {
    assertId(hook.id, "Flow Hook");
    if (flowHookIds.has(hook.id)) fail("DUPLICATE_FLOW_HOOK", `Flow Hook ID “${hook.id}”重复`, { path: hook.id });
    flowHookIds.add(hook.id);
  }
  if (flowHooks.length > 16) fail("INVALID_FLOW_HOOKS", "App 最多声明 16 个 Flow Hook");
  const configuredPlugins = [...(options.plugins ?? [])];
  const inferredPlugins = skills.flatMap((skill) => [...skill.plugins]);
  const pluginsById = new Map<string, PortablePluginDefinition>();
  for (const plugin of [...configuredPlugins, ...inferredPlugins]) {
    const current = pluginsById.get(plugin.id);
    if (current && current !== plugin) fail("DUPLICATE_PLUGIN", `Plugin ID “${plugin.id}”引用了不同定义`, { path: plugin.id });
    pluginsById.set(plugin.id, plugin);
  }
  const runtimeVariables: VariableRef<unknown>[] = interaction ? [
    variable.string("session_id"),
    variable.array<Array<{ role: "user" | "assistant"; content: string }>>("conversation_history"),
    variable.markdown("knowledge_context"),
  ] : [];
  if (background) runtimeVariables.push(
    variable.object("background_trigger", { type: "manual" }),
    variable.string("gateway_run_id"),
  );
  const flow = new FlowBuilder([...(options.variables ?? []), ...runtimeVariables], skills);
  const result = build({ flow }) as unknown;
  if (result && typeof (result as { then?: unknown }).then === "function") {
    fail("ASYNC_BUILDER_UNSUPPORTED", "defineApp() 的流程 Builder 必须同步执行；异步工作应放在构建脚本调用 writeAi() 之前");
  }
  const prepared: PreparedApp = {
    project: {
      ...flow.finish(options.name, skills, options.visualizations ?? [], interaction, { id: options.id, version: options.version, background }, execution),
      ...(flowHooks.length ? { flowHookIds: flowHooks.map((hook) => hook.id) } : {}),
    },
    plugins: [...pluginsById.values()],
    codes: flow.codes(),
    hooks: flow.hooks(),
    flowHooks,
  };
  validateBackgroundFlow(prepared.project, background);
  return Object.freeze({ id: options.id, version: options.version, name: options.name, prepared, [APP]: true as const }) as InternalApp;
}

function executionLimit(value: number, maximum: number, subject: string) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail("INVALID_EXECUTION_LIMIT", `${subject} 必须为 1–${maximum} 的整数`);
  return value;
}

function jsonClone(value: unknown, subject: string) {
  try {
    const encoded = JSON.stringify(value ?? {});
    if (encoded.length > 65_536) fail("INVALID_BACKGROUND", `${subject} 超过 64 KiB`);
    return JSON.parse(encoded) as Record<string, BackgroundValue>;
  } catch (error) {
    if (error instanceof AiSdkError) throw error;
    fail("INVALID_BACKGROUND", `${subject} 必须是可序列化 JSON`);
  }
}

function normalizeBackground(value: AppBackgroundOptions | undefined, appId?: string, version?: string): AppBackgroundConfig | undefined {
  if (!value) return undefined;
  if (!appId) fail("BACKGROUND_APP_ID_REQUIRED", "后台应用必须声明稳定 id");
  assertId(appId, "App");
  if (!version || version.length > 32 || !/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version)) fail("BACKGROUND_VERSION_REQUIRED", "后台应用必须声明有效 version");
  if (!value.heartbeat && !(value.cron?.length)) fail("BACKGROUND_TRIGGER_REQUIRED", "background 至少需要 heartbeat 或 cron 触发器");
  const historyWindow = value.historyWindow ?? 20;
  if (!Number.isInteger(historyWindow) || historyWindow < 1 || historyWindow > 100) fail("INVALID_BACKGROUND", "background.historyWindow 必须为 1–100");
  const ids = new Set<string>();
  const register = (id: string) => { assertId(id, "Background trigger"); if (ids.has(id)) fail("DUPLICATE_BACKGROUND_TRIGGER", `后台触发器 ID “${id}”重复`); ids.add(id); };
  const heartbeat = value.heartbeat ? (() => {
    register(value.heartbeat!.id);
    if (!Number.isInteger(value.heartbeat!.everyMs) || value.heartbeat!.everyMs < 60_000 || value.heartbeat!.everyMs > 86_400_000) fail("INVALID_HEARTBEAT", "heartbeat.everyMs 必须为 60000–86400000");
    return { id: value.heartbeat!.id, everyMs: value.heartbeat!.everyMs, input: value.heartbeat!.input, variables: jsonClone(value.heartbeat!.variables, "heartbeat.variables"), runOnStart: value.heartbeat!.runOnStart === true };
  })() : undefined;
  if ((value.cron?.length ?? 0) > 64) fail("INVALID_CRON", "background.cron 最多包含 64 个触发器");
  const cron = (value.cron ?? []).map((trigger) => {
    register(trigger.id);
    try { parseCronExpression(trigger.expression); assertTimeZone(trigger.timezone); nextCronOccurrence(trigger.expression, trigger.timezone, new Date()); }
    catch (error) { fail("INVALID_CRON", `Cron“${trigger.id}”无效：${error instanceof Error ? error.message : String(error)}`); }
    const misfireGraceMs = trigger.misfireGraceMs ?? 900_000;
    if (!Number.isInteger(misfireGraceMs) || misfireGraceMs < 0 || misfireGraceMs > 86_400_000) fail("INVALID_CRON", `Cron“${trigger.id}”的 misfireGraceMs 必须为 0–86400000`);
    return { id: trigger.id, expression: trigger.expression.trim(), timezone: trigger.timezone, input: trigger.input, variables: jsonClone(trigger.variables, `cron.${trigger.id}.variables`), misfireGraceMs };
  });
  return { historyWindow, ...(heartbeat ? { heartbeat } : {}), ...(cron.length ? { cron } : {}) };
}

function validateBackgroundFlow(project: PreparedApp["project"], background: AppBackgroundConfig | undefined) {
  const contacts = project.nodes.filter((node) => node.type === "CONTACT");
  if (contacts.length && !background) fail("CONTACT_REQUIRES_BACKGROUND", "flow.contact() 要求 defineApp() 声明 background", { nodeId: contacts[0].id });
  if (!background) return;
  const definitions = new Map(project.variables.map((variable) => [variable.name, variable]));
  const triggers = [...(background.heartbeat ? [background.heartbeat] : []), ...(background.cron ?? [])];
  for (const node of project.nodes.filter((item) => item.type === "INPUT")) {
    const fields = Array.isArray(node.config?.fields) ? node.config.fields as Array<Record<string, unknown>> : [];
    for (const trigger of triggers) for (const field of fields) {
      const name = String(field.variable ?? "");
      const supplied = Object.hasOwn(trigger.variables ?? {}, name) || (name === "user_input" && trigger.input.length > 0);
      const definition = definitions.get(name);
      const hasDefault = definition !== undefined && (definition.type === "boolean" || definition.type === "number" || definition.defaultValue !== "");
      if (!supplied && !hasDefault) fail("BACKGROUND_INPUT_REQUIRED", `触发器“${trigger.id}”未提供 INPUT 变量“${name}”`, { nodeId: node.id });
    }
  }
}

function normalizeInteraction(value: AppInteractionOptions | undefined): AppInteractionConfig | undefined {
  if (!value) return undefined;
  const history = value.conversation?.history === true;
  const conversation = value.conversation ? {
    multiTurn: history || value.conversation.multiTurn === true,
    history,
    historyWindow: value.conversation.historyWindow ?? 20,
  } : undefined;
  const knowledge = value.knowledge ? {
    enabled: true as const,
    scopes: [...(value.knowledge.scopes ?? ["app"])],
    topK: value.knowledge.topK ?? 6,
    chunkSize: value.knowledge.chunkSize ?? 1200,
    chunkOverlap: value.knowledge.chunkOverlap ?? 200,
  } : undefined;
  const streaming = value.streaming ? { defaultMode: value.streaming.defaultMode } : undefined;
  if (conversation && (!Number.isInteger(conversation.historyWindow) || conversation.historyWindow < 1 || conversation.historyWindow > 100)) fail("INVALID_INTERACTION", "conversation.historyWindow 必须为 1–100");
  if (knowledge && (!Number.isInteger(knowledge.topK) || knowledge.topK < 1 || knowledge.topK > 20)) fail("INVALID_INTERACTION", "knowledge.topK 必须为 1–20");
  if (knowledge && (!Number.isInteger(knowledge.chunkSize) || knowledge.chunkSize < 200 || knowledge.chunkSize > 8000)) fail("INVALID_INTERACTION", "knowledge.chunkSize 必须为 200–8000");
  if (knowledge && (!Number.isInteger(knowledge.chunkOverlap) || knowledge.chunkOverlap < 0 || knowledge.chunkOverlap > 2000)) fail("INVALID_INTERACTION", "knowledge.chunkOverlap 必须为 0–2000");
  if (knowledge?.scopes.includes("session") && !history) fail("SESSION_KNOWLEDGE_REQUIRES_HISTORY", "会话级知识库要求 conversation.history=true");
  if (knowledge && knowledge.chunkOverlap >= knowledge.chunkSize) fail("INVALID_INTERACTION", "knowledge.chunkOverlap 必须小于 chunkSize");
  if (streaming && streaming.defaultMode !== "text" && streaming.defaultMode !== "events") fail("INVALID_INTERACTION", "streaming.defaultMode 必须为 text 或 events");
  return { ...(conversation ? { conversation } : {}), ...(knowledge ? { knowledge } : {}), ...(streaming ? { streaming } : {}) };
}

export function preparedApp(app: AppDefinition): PreparedApp {
  if (!app || typeof app !== "object" || !(APP in app)) fail("INVALID_APP", "需要由 defineApp() 创建的 AppDefinition");
  return (app as InternalApp).prepared;
}
