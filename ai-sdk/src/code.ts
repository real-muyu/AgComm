import type { PluginContext, PluginValue } from "../../../runtime/plugins/sdk.ts";
import type { Template, VariableRef, VariableKind } from "./model.ts";
import { validateBundleDefinition, type BundleLimits } from "./portable.ts";

export type CodeValue = PluginValue;
export type CodeContext = PluginContext;
export type CodeSchema = Record<string, unknown>;

export type CodeDefinition<TInput extends CodeValue = CodeValue, TOutput extends CodeValue = CodeValue> = {
  readonly entry: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly inputSchema: CodeSchema;
  readonly outputSchema: CodeSchema;
  readonly permissions: readonly string[];
  readonly limits?: BundleLimits;
  run(input: TInput, context: CodeContext): Promise<TOutput> | TOutput;
};

export type DefineCodeOptions<TInput extends CodeValue, TOutput extends CodeValue> = Omit<CodeDefinition<TInput, TOutput>, "permissions"> & {
  permissions?: readonly string[];
};

export type CodeInput<T> =
  | VariableRef<T>
  | (T extends string ? T | Template
    : T extends number | boolean | null ? T
      : T extends readonly (infer TItem)[] ? readonly CodeInput<TItem>[]
        : T extends Record<string, unknown> ? { readonly [TKey in keyof T]: CodeInput<T[TKey]> }
          : T);

const ALLOWED_SCHEMA_KEYS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "const",
  "minLength", "maxLength", "pattern", "minimum", "maximum", "minItems", "maxItems",
]);
const JSON_TYPES = new Set(["null", "boolean", "number", "integer", "string", "array", "object"]);

function schemaError(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function assertJsonValue(value: unknown, path: string, depth = 0): void {
  if (depth > 32) schemaError(path, "value nesting exceeds 32 levels");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) schemaError(path, "number must be finite");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => assertJsonValue(item, `${path}.${key}`, depth + 1));
    return;
  }
  schemaError(path, "value must be JSON serializable");
}

export function assertCodeSchema(schema: CodeSchema, path: string): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) schemaError(path, "schema must be an object");
  for (const key of Object.keys(schema)) if (!ALLOWED_SCHEMA_KEYS.has(key)) schemaError(path, `unsupported keyword ${key}`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  if (!types.length || types.some((type) => typeof type !== "string" || !JSON_TYPES.has(type))) schemaError(`${path}.type`, "must declare supported JSON type(s)");
  if (new Set(types).size !== types.length) schemaError(`${path}.type`, "must not contain duplicates");
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.length) schemaError(`${path}.enum`, "must be a non-empty array");
    assertJsonValue(schema.enum, `${path}.enum`);
  }
  if (Object.hasOwn(schema, "const")) assertJsonValue(schema.const, `${path}.const`);
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string") schemaError(`${path}.pattern`, "must be a string");
    try { new RegExp(schema.pattern, "u"); } catch { schemaError(`${path}.pattern`, "must be a valid regular expression"); }
  }
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"] as const) {
    if (schema[key] !== undefined && (!Number.isInteger(schema[key]) || Number(schema[key]) < 0)) schemaError(`${path}.${key}`, "must be a non-negative integer");
  }
  for (const key of ["minimum", "maximum"] as const) {
    if (schema[key] !== undefined && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) schemaError(`${path}.${key}`, "must be a finite number");
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string") || new Set(schema.required).size !== schema.required.length) {
      schemaError(`${path}.required`, "must be an array of unique strings");
    }
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") schemaError(`${path}.additionalProperties`, "must be boolean");
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) schemaError(`${path}.properties`, "must be an object");
    for (const [key, child] of Object.entries(schema.properties as Record<string, unknown>)) assertCodeSchema(child as CodeSchema, `${path}.properties.${key}`);
  }
  if (schema.items !== undefined) assertCodeSchema(schema.items as CodeSchema, `${path}.items`);
}

export function outputKindForCode(schema: CodeSchema): VariableKind {
  assertCodeSchema(schema, "outputSchema");
  const types = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter((type) => type !== "null");
  if (types.length !== 1) schemaError("outputSchema.type", "must contain exactly one non-null type");
  const type = types[0];
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  if (type === "string") return "string";
  return schemaError("outputSchema.type", "null-only outputs cannot be stored in a flow variable");
}

export function defineCode<TInput extends CodeValue, TOutput extends CodeValue>(options: DefineCodeOptions<TInput, TOutput>): CodeDefinition<TInput, TOutput> {
  const permissions = validateBundleDefinition(options, "Code");
  assertCodeSchema(options.inputSchema, "inputSchema");
  outputKindForCode(options.outputSchema);
  if (typeof options.run !== "function") throw new Error("Code must define run(input, context)");
  return Object.freeze({ ...options, permissions });
}
