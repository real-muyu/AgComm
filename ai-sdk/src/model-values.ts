import type { AiSdkIssue, DefineSkillOptions, NodeRef, SkillDefinition, Template, VariableKind, VariableRef } from "./model-types.ts";
import { AiSdkError } from "./model-types.ts";
import { BRANCH_REF, TEMPLATE, VALUE_REF } from "./model-symbols.ts";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const REFERENCE_PATTERN = /\{\{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\}\}/g;
export const RESERVED_VARIABLES = new Set(["session_id", "conversation_history", "knowledge_context", "background_trigger", "gateway_run_id"]);

export function fail(code: string, message: string, issue: Omit<AiSdkIssue, "code" | "message"> = {}): never {
  throw new AiSdkError(code, message, [{ code, message, ...issue }]);
}
export function assertId(id: string, subject: string) { if (!ID_PATTERN.test(id)) fail("INVALID_ID", `${subject} ID “${id}” 无效`, { path: subject }); }
export function defaultFor(kind: VariableKind): unknown { if (kind === "number") return 0; if (kind === "boolean") return false; if (kind === "array") return []; if (kind === "object") return {}; return ""; }
export function variableRef<T>(kind: VariableKind, name: string, value: T): VariableRef<T> {
  if (!VARIABLE_PATTERN.test(name)) fail("INVALID_VARIABLE", `变量名“${name}”无效`, { path: name });
  return Object.freeze({ name, kind, defaultValue: value, [VALUE_REF]: "variable" as const });
}
export const variable = {
  string: (name: string, defaultValue = "") => variableRef("string", name, defaultValue),
  markdown: (name: string, defaultValue = "") => variableRef("markdown", name, defaultValue),
  number: (name: string, defaultValue = 0) => variableRef("number", name, defaultValue),
  boolean: (name: string, defaultValue = false) => variableRef("boolean", name, defaultValue),
  array<T extends unknown[]>(name: string, defaultValue = [] as unknown as T) { return variableRef("array", name, defaultValue); },
  object<T extends Record<string, unknown>>(name: string, defaultValue = {} as T) { return variableRef("object", name, defaultValue); },
};
export function isValueRef(value: unknown): value is VariableRef<unknown> | NodeRef<unknown> { return Boolean(value && typeof value === "object" && VALUE_REF in value); }
export function isNodeRef(value: unknown): value is NodeRef<unknown> { return isValueRef(value) && value[VALUE_REF] === "node"; }
export function isBranchRef(value: unknown): value is import("./model-types.ts").ConditionBranchRef { return Boolean(value && typeof value === "object" && BRANCH_REF in value); }
export function isTemplate(value: unknown): value is Template { return Boolean(value && typeof value === "object" && TEMPLATE in value); }
export function template(strings: TemplateStringsArray, ...values: unknown[]): Template {
  let text = strings[0] ?? "";
  values.forEach((value, index) => { text += isValueRef(value) ? `{{${value.name}}}` : isTemplate(value) ? value.text : String(value ?? ""); text += strings[index + 1] ?? ""; });
  return Object.freeze({ text, [TEMPLATE]: true as const });
}
export function defineSkill(options: DefineSkillOptions): SkillDefinition {
  assertId(options.id, "Skill"); if (!options.name.trim()) fail("INVALID_SKILL", `Skill “${options.id}” 缺少名称`);
  return Object.freeze({ id: options.id, name: options.name, description: options.description ?? "", category: options.category ?? "未分类", prompt: options.prompt, plugins: [...(options.plugins ?? [])] });
}
export function encodeDefault(ref: VariableRef<unknown>) {
  if (ref.kind === "array" || ref.kind === "object") { try { return JSON.stringify(ref.defaultValue); } catch (error) { throw new AiSdkError("INVALID_VARIABLE_DEFAULT", `变量“${ref.name}”的默认值无法序列化`, [], { cause: error }); } }
  return String(ref.defaultValue ?? "");
}
export function serializeValue(value: unknown): unknown {
  if (isValueRef(value)) return `{{${value.name}}}`; if (isTemplate(value)) return value.text;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]));
  return value;
}
export function collectReferenceNames(value: unknown, names = new Set<string>()) {
  const serialized = serializeValue(value);
  if (typeof serialized === "string") for (const match of serialized.matchAll(REFERENCE_PATTERN)) names.add(match[1].split(".")[0]);
  else if (Array.isArray(serialized)) for (const item of serialized) collectReferenceNames(item, names);
  else if (serialized && typeof serialized === "object") for (const item of Object.values(serialized)) collectReferenceNames(item, names);
  return names;
}
export function inferredKind(value: unknown): VariableKind {
  if (isValueRef(value)) return value.kind; if (isTemplate(value) || typeof value === "string") return "markdown";
  if (typeof value === "number") return "number"; if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array"; return value && typeof value === "object" ? "object" : "markdown";
}
