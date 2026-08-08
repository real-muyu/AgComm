import type { VariableKind } from "./model-types.ts";

export type CodeSchema = Record<string, unknown>;

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

function assertSchemaObject(schema: CodeSchema, path: string): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) schemaError(path, "schema must be an object");
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) schemaError(path, `unsupported keyword ${key}`);
  }
}

function schemaTypes(schema: CodeSchema, path: string): unknown[] {
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  if (!types.length || types.some((type) => typeof type !== "string" || !JSON_TYPES.has(type))) {
    schemaError(`${path}.type`, "must declare supported JSON type(s)");
  }
  if (new Set(types).size !== types.length) schemaError(`${path}.type`, "must not contain duplicates");
  return types;
}

function assertValueConstraints(schema: CodeSchema, path: string): void {
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.length) schemaError(`${path}.enum`, "must be a non-empty array");
    assertJsonValue(schema.enum, `${path}.enum`);
  }
  if (Object.hasOwn(schema, "const")) assertJsonValue(schema.const, `${path}.const`);
  if (schema.pattern !== undefined) assertPattern(schema.pattern, path);
}

function assertPattern(pattern: unknown, path: string): void {
  if (typeof pattern !== "string") schemaError(`${path}.pattern`, "must be a string");
  try { new RegExp(pattern, "u"); }
  catch { schemaError(`${path}.pattern`, "must be a valid regular expression"); }
}

function assertNumericConstraints(schema: CodeSchema, path: string): void {
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"] as const) {
    const value = schema[key];
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0)) {
      schemaError(`${path}.${key}`, "must be a non-negative integer");
    }
  }
  for (const key of ["minimum", "maximum"] as const) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      schemaError(`${path}.${key}`, "must be a finite number");
    }
  }
}

function assertObjectConstraints(schema: CodeSchema, path: string): void {
  if (schema.required !== undefined) {
    const required = schema.required;
    if (!Array.isArray(required) || required.some((key) => typeof key !== "string") || new Set(required).size !== required.length) {
      schemaError(`${path}.required`, "must be an array of unique strings");
    }
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    schemaError(`${path}.additionalProperties`, "must be boolean");
  }
  if (schema.properties === undefined) return;
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    schemaError(`${path}.properties`, "must be an object");
  }
  for (const [key, child] of Object.entries(schema.properties as Record<string, unknown>)) {
    assertCodeSchema(child as CodeSchema, `${path}.properties.${key}`);
  }
}

export function assertCodeSchema(schema: CodeSchema, path: string): void {
  assertSchemaObject(schema, path);
  schemaTypes(schema, path);
  assertValueConstraints(schema, path);
  assertNumericConstraints(schema, path);
  assertObjectConstraints(schema, path);
  if (schema.items !== undefined) assertCodeSchema(schema.items as CodeSchema, `${path}.items`);
}

export function outputKindForCode(schema: CodeSchema): VariableKind {
  assertCodeSchema(schema, "outputSchema");
  const types = schemaTypes(schema, "outputSchema").filter((type) => type !== "null");
  if (types.length !== 1) schemaError("outputSchema.type", "must contain exactly one non-null type");
  const type = types[0];
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  if (type === "string") return "string";
  return schemaError("outputSchema.type", "null-only outputs cannot be stored in a flow variable");
}
