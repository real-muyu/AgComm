// src/portable.ts
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var PERMISSION_PATTERN = /^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$/;
function validateBundleDefinition(definition, subject) {
  if (!ID_PATTERN.test(definition.id)) throw new Error(`Invalid ${subject} ID: ${definition.id}`);
  if (!definition.name.trim() || !definition.description.trim() || !definition.version.trim()) {
    throw new Error(`${subject} name, description, and version are required`);
  }
  let entry;
  try {
    entry = new URL(definition.entry);
  } catch {
    throw new Error(`${subject} entry must be a file URL created with import.meta.url`);
  }
  if (entry.protocol !== "file:" && entry.href !== "agent-plugin:bundle") throw new Error(`${subject} entry must use the file: protocol`);
  const permissions = [...new Set(definition.permissions ?? [])];
  if (permissions.some((permission) => !PERMISSION_PATTERN.test(permission))) {
    throw new Error(`${subject} permissions contain an invalid permission name`);
  }
  return permissions;
}

// src/code-schema.ts
var ALLOWED_SCHEMA_KEYS = /* @__PURE__ */ new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "minItems",
  "maxItems"
]);
var JSON_TYPES = /* @__PURE__ */ new Set(["null", "boolean", "number", "integer", "string", "array", "object"]);
function schemaError(path, message) {
  throw new Error(`${path}: ${message}`);
}
function assertJsonValue(value, path, depth = 0) {
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
function assertSchemaObject(schema, path) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) schemaError(path, "schema must be an object");
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) schemaError(path, `unsupported keyword ${key}`);
  }
}
function schemaTypes(schema, path) {
  const types = Array.isArray(schema.type) ? schema.type : schema.type === void 0 ? [] : [schema.type];
  if (!types.length || types.some((type) => typeof type !== "string" || !JSON_TYPES.has(type))) {
    schemaError(`${path}.type`, "must declare supported JSON type(s)");
  }
  if (new Set(types).size !== types.length) schemaError(`${path}.type`, "must not contain duplicates");
  return types;
}
function assertValueConstraints(schema, path) {
  if (schema.enum !== void 0) {
    if (!Array.isArray(schema.enum) || !schema.enum.length) schemaError(`${path}.enum`, "must be a non-empty array");
    assertJsonValue(schema.enum, `${path}.enum`);
  }
  if (Object.hasOwn(schema, "const")) assertJsonValue(schema.const, `${path}.const`);
  if (schema.pattern !== void 0) assertPattern(schema.pattern, path);
}
function assertPattern(pattern, path) {
  if (typeof pattern !== "string") schemaError(`${path}.pattern`, "must be a string");
  try {
    new RegExp(pattern, "u");
  } catch {
    schemaError(`${path}.pattern`, "must be a valid regular expression");
  }
}
function assertNumericConstraints(schema, path) {
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) {
    const value = schema[key];
    if (value !== void 0 && (!Number.isInteger(value) || Number(value) < 0)) {
      schemaError(`${path}.${key}`, "must be a non-negative integer");
    }
  }
  for (const key of ["minimum", "maximum"]) {
    const value = schema[key];
    if (value !== void 0 && (typeof value !== "number" || !Number.isFinite(value))) {
      schemaError(`${path}.${key}`, "must be a finite number");
    }
  }
}
function assertObjectConstraints(schema, path) {
  if (schema.required !== void 0) {
    const required = schema.required;
    if (!Array.isArray(required) || required.some((key) => typeof key !== "string") || new Set(required).size !== required.length) {
      schemaError(`${path}.required`, "must be an array of unique strings");
    }
  }
  if (schema.additionalProperties !== void 0 && typeof schema.additionalProperties !== "boolean") {
    schemaError(`${path}.additionalProperties`, "must be boolean");
  }
  if (schema.properties === void 0) return;
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    schemaError(`${path}.properties`, "must be an object");
  }
  for (const [key, child] of Object.entries(schema.properties)) {
    assertCodeSchema(child, `${path}.properties.${key}`);
  }
}
function assertCodeSchema(schema, path) {
  assertSchemaObject(schema, path);
  schemaTypes(schema, path);
  assertValueConstraints(schema, path);
  assertNumericConstraints(schema, path);
  assertObjectConstraints(schema, path);
  if (schema.items !== void 0) assertCodeSchema(schema.items, `${path}.items`);
}
function outputKindForCode(schema) {
  assertCodeSchema(schema, "outputSchema");
  const types = schemaTypes(schema, "outputSchema").filter((type2) => type2 !== "null");
  if (types.length !== 1) schemaError("outputSchema.type", "must contain exactly one non-null type");
  const type = types[0];
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  if (type === "string") return "string";
  return schemaError("outputSchema.type", "null-only outputs cannot be stored in a flow variable");
}

// src/code.ts
function defineCode(options) {
  const permissions = validateBundleDefinition(options, "Code");
  assertCodeSchema(options.inputSchema, "inputSchema");
  outputKindForCode(options.outputSchema);
  if (typeof options.run !== "function") throw new Error("Code must define run(input, context)");
  return Object.freeze({ ...options, permissions });
}
export {
  assertCodeSchema,
  defineCode,
  outputKindForCode
};
