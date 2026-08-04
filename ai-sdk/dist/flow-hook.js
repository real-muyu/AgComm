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
function createHandlerTools(operations, handlers, schemas, permissions, subject) {
  return Object.fromEntries(operations.map((operation) => [operation, {
    description: `${subject} ${operation}`,
    inputSchema: schemas[operation].inputSchema,
    outputSchema: schemas[operation].outputSchema,
    permissions: [...permissions],
    run: handlers[operation]
  }]));
}

// src/flow-hook.ts
var FLOW_HOOK_OPERATIONS = ["beforeNode", "afterNode", "onNodeError"];
var VALUE_SCHEMA = { type: ["null", "boolean", "number", "string", "array", "object"] };
var COMMON_PROPERTIES = { state: VALUE_SCHEMA };
var objectResult = (properties) => ({
  type: ["object", "null"],
  properties: { ...COMMON_PROPERTIES, ...properties },
  additionalProperties: false
});
var FLOW_HOOK_SCHEMAS = Object.freeze({
  beforeNode: { inputSchema: { type: "object" }, outputSchema: objectResult({ config: { type: "object" }, skipWith: VALUE_SCHEMA }) },
  afterNode: { inputSchema: { type: "object" }, outputSchema: objectResult({ output: VALUE_SCHEMA }) },
  onNodeError: { inputSchema: { type: "object" }, outputSchema: objectResult({ recoverWith: VALUE_SCHEMA }) }
});
function defineFlowHook(options) {
  const permissions = validateBundleDefinition(options, "Flow Hook");
  const operations = FLOW_HOOK_OPERATIONS.filter((operation) => typeof options.handlers[operation] === "function");
  if (!operations.length) throw new Error("Flow Hook must define at least one handler");
  const tools = createHandlerTools(operations, options.handlers, FLOW_HOOK_SCHEMAS, permissions, "Flow Hook");
  return Object.freeze({ ...options, permissions, handlers: Object.freeze({ ...options.handlers }), tools: Object.freeze(tools) });
}
export {
  FLOW_HOOK_OPERATIONS,
  FLOW_HOOK_SCHEMAS,
  defineFlowHook
};
