// ../../domain/flow/editor.ts
function connectionId(edge, index = 0) {
  return edge.id?.trim() || `edge_${index}`;
}
function createConnection(from, to, edges) {
  const stem = `edge_${from.slice(0, 20)}_${to.slice(0, 20)}`;
  let id = stem;
  let suffix = 2;
  const ids = new Set(edges.map((edge, index) => connectionId(edge, index)));
  while (ids.has(id)) id = `${stem}_${suffix++}`;
  return { id, from, to };
}
function autoLayoutNodes(nodes, edges) {
  const ids = new Set(nodes.map((node2) => node2.id));
  const indegree = new Map(nodes.map((node2) => [node2.id, 0]));
  const outgoing = new Map(nodes.map((node2) => [node2.id, []]));
  for (const edge of edges) if (ids.has(edge.from) && ids.has(edge.to)) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const levels = /* @__PURE__ */ new Map();
  const queue = nodes.filter((node2) => (indegree.get(node2.id) ?? 0) === 0).map((node2) => node2.id);
  for (const id of queue) levels.set(id, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const target of outgoing.get(id) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, (levels.get(id) ?? 0) + 1));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  const fallback = Math.max(0, ...levels.values()) + 1;
  for (const node2 of nodes) if (!levels.has(node2.id)) levels.set(node2.id, fallback);
  const columns = /* @__PURE__ */ new Map();
  for (const node2 of nodes) {
    const level = levels.get(node2.id) ?? 0;
    columns.set(level, [...columns.get(level) ?? [], node2]);
  }
  return nodes.map((node2) => {
    const level = levels.get(node2.id) ?? 0;
    const column = columns.get(level) ?? [];
    const row = column.findIndex((item) => item.id === node2.id);
    const height = Math.max(1, column.length) * 112;
    return { ...node2, x: 24 + level * 210, y: Math.max(24, 250 - height / 2 + row * 112) };
  });
}

// src/background-schedule.ts
var FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7, sunday: true }
];
function fieldValue(raw, field) {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid Cron value: ${raw}`);
  const value = Number(raw);
  if (value < field.min || value > field.max) throw new Error(`Cron value out of range: ${raw}`);
  return field.sunday && value === 7 ? 0 : value;
}
function parseField(source, field) {
  const values = /* @__PURE__ */ new Set();
  for (const part of source.split(",")) {
    if (!part) throw new Error("Cron field contains an empty list item");
    const [rangeSource, stepSource, extra] = part.split("/");
    if (extra !== void 0) throw new Error(`Invalid Cron step: ${part}`);
    const step = stepSource === void 0 ? 1 : Number(stepSource);
    if (!Number.isInteger(step) || step < 1 || step > field.max - field.min + 1) throw new Error(`Invalid Cron step: ${part}`);
    let start = field.min;
    let end = field.max;
    if (rangeSource !== "*") {
      const range = rangeSource.split("-");
      if (range.length > 2) throw new Error(`Invalid Cron range: ${part}`);
      start = fieldValue(range[0], field);
      end = range.length === 2 ? fieldValue(range[1], field) : start;
      if (field.sunday && range.length === 2 && range[1] === "7") end = 7;
      if (start > end) throw new Error(`Descending Cron range is not supported: ${part}`);
    }
    for (let value = start; value <= end; value += step) values.add(field.sunday && value === 7 ? 0 : value);
  }
  return values;
}
function parseCronExpression(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must contain exactly five fields");
  const parsed = parts.map((part, index) => parseField(part, FIELDS[index]));
  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
    anyDayOfMonth: parts[2] === "*",
    anyDayOfWeek: parts[4] === "*"
  };
}
function assertTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch (error) {
    throw new Error(`Invalid IANA timezone: ${timezone}`, { cause: error });
  }
}
function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  return { minute: value("minute"), hour: value("hour"), day: value("day"), month: value("month"), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday ?? "") };
}
function cronMatches(parsed, date, timezone) {
  const value = zonedParts(date, timezone);
  const dayOfMonth = parsed.dayOfMonth.has(value.day);
  const dayOfWeek = parsed.dayOfWeek.has(value.weekday);
  const dayMatches = parsed.anyDayOfMonth ? dayOfWeek : parsed.anyDayOfWeek ? dayOfMonth : dayOfMonth || dayOfWeek;
  return parsed.minute.has(value.minute) && parsed.hour.has(value.hour) && parsed.month.has(value.month) && dayMatches;
}
function nextCronOccurrence(expression, timezone, after, limitMinutes = 2 * 366 * 24 * 60) {
  assertTimeZone(timezone);
  const parsed = typeof expression === "string" ? parseCronExpression(expression) : expression;
  const cursor = new Date(Math.floor(after.getTime() / 6e4) * 6e4 + 6e4);
  for (let index = 0; index < limitMinutes; index++, cursor.setTime(cursor.getTime() + 6e4)) {
    if (cronMatches(parsed, cursor, timezone)) return new Date(cursor);
  }
  throw new Error("Cron expression has no occurrence within the supported two-year window");
}

// ../../lib/flow-runtime/template.ts
function getPath(source, path) {
  return path.split(".").reduce((current, key) => {
    if (current === null || current === void 0 || typeof current !== "object") return void 0;
    return current[key];
  }, source);
}

// ../../lib/flow-runtime/expression.ts
var OPERATORS = ["===", "!==", ">=", "<=", "==", "!=", "&&", "||", ">", "<", "!"];
var Lexer = class {
  constructor(input) {
    this.position = 0;
    this.input = input;
  }
  next() {
    while (/\s/.test(this.input[this.position] ?? "")) this.position++;
    const start = this.position;
    if (start >= this.input.length) return { type: "eof", value: "", position: start };
    const char = this.input[start];
    if (char === "(" || char === ")") {
      this.position++;
      return { type: "paren", value: char, position: start };
    }
    const operator = OPERATORS.find((candidate) => this.input.startsWith(candidate, start));
    if (operator) {
      this.position += operator.length;
      return { type: "operator", value: operator, position: start };
    }
    if (char === '"' || char === "'") {
      const quote = char;
      this.position++;
      let value = "";
      while (this.position < this.input.length && this.input[this.position] !== quote) {
        if (this.input[this.position] === "\\") {
          this.position++;
          const escaped = this.input[this.position];
          const map = { n: "\n", r: "\r", t: "	", "\\": "\\", '"': '"', "'": "'" };
          value += map[escaped] ?? escaped;
        } else value += this.input[this.position];
        this.position++;
      }
      if (this.input[this.position] !== quote) throw new Error(`\u5B57\u7B26\u4E32\u672A\u95ED\u5408\uFF08\u4F4D\u7F6E ${start}\uFF09`);
      this.position++;
      return { type: "string", value, position: start };
    }
    const number = this.input.slice(start).match(/^-?(?:\d+\.?\d*|\.\d+)/)?.[0];
    if (number) {
      this.position += number.length;
      return { type: "number", value: number, position: start };
    }
    const identifier = this.input.slice(start).match(/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*/)?.[0];
    if (identifier) {
      this.position += identifier.length;
      return { type: "identifier", value: identifier, position: start };
    }
    throw new Error(`\u4E0D\u652F\u6301\u7684\u5B57\u7B26\u201C${char}\u201D\uFF08\u4F4D\u7F6E ${start}\uFF09`);
  }
};
var Parser = class {
  constructor(lexer, variables) {
    this.lexer = lexer;
    this.variables = variables;
    this.current = lexer.next();
  }
  parse() {
    const result = this.parseOr();
    if (this.current.type !== "eof") throw new Error(`\u8868\u8FBE\u5F0F\u5728\u4F4D\u7F6E ${this.current.position} \u540E\u5B58\u5728\u591A\u4F59\u5185\u5BB9`);
    return result;
  }
  advance() {
    const token = this.current;
    this.current = this.lexer.next();
    return token;
  }
  match(value) {
    if (this.current.value !== value) return false;
    this.advance();
    return true;
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.match("||")) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }
  parseAnd() {
    let left = this.parseComparison();
    while (this.match("&&")) {
      const right = this.parseComparison();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }
  parseComparison() {
    let left = this.parseUnary();
    while (["===", "!==", "==", "!=", ">=", "<=", ">", "<"].includes(this.current.value)) {
      const operator = this.advance().value;
      const right = this.parseUnary();
      if (operator === "==" || operator === "===") left = left === right;
      else if (operator === "!=" || operator === "!==") left = left !== right;
      else {
        if (left === void 0 || left === null || right === void 0 || right === null) {
          left = false;
          continue;
        }
        const numericLeft = typeof left === "number" ? left : Number(left);
        const numericRight = typeof right === "number" ? right : Number(right);
        if (!Number.isFinite(numericLeft) || !Number.isFinite(numericRight)) throw new Error(`\u8FD0\u7B97\u7B26 ${operator} \u4E24\u4FA7\u5FC5\u987B\u662F\u6570\u503C`);
        if (operator === ">=") left = numericLeft >= numericRight;
        if (operator === "<=") left = numericLeft <= numericRight;
        if (operator === ">") left = numericLeft > numericRight;
        if (operator === "<") left = numericLeft < numericRight;
      }
    }
    return left;
  }
  parseUnary() {
    if (this.match("!")) return !this.parseUnary();
    return this.parsePrimary();
  }
  parsePrimary() {
    if (this.match("(")) {
      const value = this.parseOr();
      if (!this.match(")")) throw new Error(`\u7F3A\u5C11\u53F3\u62EC\u53F7\uFF08\u4F4D\u7F6E ${this.current.position}\uFF09`);
      return value;
    }
    const token = this.advance();
    if (token.type === "number") return Number(token.value);
    if (token.type === "string") return token.value;
    if (token.type === "identifier") {
      if (token.value === "true") return true;
      if (token.value === "false") return false;
      if (token.value === "null") return null;
      const direct = getPath(this.variables, token.value);
      if (direct !== void 0) return direct;
      if (token.value.startsWith("variables.")) return getPath(this.variables, token.value.slice(10));
      return void 0;
    }
    throw new Error(`\u4F4D\u7F6E ${token.position} \u9700\u8981\u503C`);
  }
};
function evaluateExpression(expression, variables) {
  const normalized = expression.replace(/\{\{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\}\}/g, "$1").trim();
  if (!normalized) throw new Error("\u6761\u4EF6\u8868\u8FBE\u5F0F\u4E0D\u80FD\u4E3A\u7A7A");
  return new Parser(new Lexer(normalized), variables).parse();
}
function validateExpression(expression) {
  try {
    evaluateExpression(expression, {});
    return void 0;
  } catch (error) {
    return error instanceof Error ? error.message : "\u6761\u4EF6\u8868\u8FBE\u5F0F\u65E0\u6548";
  }
}

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

// src/code.ts
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
function assertCodeSchema(schema, path) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) schemaError(path, "schema must be an object");
  for (const key of Object.keys(schema)) if (!ALLOWED_SCHEMA_KEYS.has(key)) schemaError(path, `unsupported keyword ${key}`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type === void 0 ? [] : [schema.type];
  if (!types.length || types.some((type) => typeof type !== "string" || !JSON_TYPES.has(type))) schemaError(`${path}.type`, "must declare supported JSON type(s)");
  if (new Set(types).size !== types.length) schemaError(`${path}.type`, "must not contain duplicates");
  if (schema.enum !== void 0) {
    if (!Array.isArray(schema.enum) || !schema.enum.length) schemaError(`${path}.enum`, "must be a non-empty array");
    assertJsonValue(schema.enum, `${path}.enum`);
  }
  if (Object.hasOwn(schema, "const")) assertJsonValue(schema.const, `${path}.const`);
  if (schema.pattern !== void 0) {
    if (typeof schema.pattern !== "string") schemaError(`${path}.pattern`, "must be a string");
    try {
      new RegExp(schema.pattern, "u");
    } catch {
      schemaError(`${path}.pattern`, "must be a valid regular expression");
    }
  }
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) {
    if (schema[key] !== void 0 && (!Number.isInteger(schema[key]) || Number(schema[key]) < 0)) schemaError(`${path}.${key}`, "must be a non-negative integer");
  }
  for (const key of ["minimum", "maximum"]) {
    if (schema[key] !== void 0 && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) schemaError(`${path}.${key}`, "must be a finite number");
  }
  if (schema.required !== void 0) {
    if (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string") || new Set(schema.required).size !== schema.required.length) {
      schemaError(`${path}.required`, "must be an array of unique strings");
    }
  }
  if (schema.additionalProperties !== void 0 && typeof schema.additionalProperties !== "boolean") schemaError(`${path}.additionalProperties`, "must be boolean");
  if (schema.properties !== void 0) {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) schemaError(`${path}.properties`, "must be an object");
    for (const [key, child] of Object.entries(schema.properties)) assertCodeSchema(child, `${path}.properties.${key}`);
  }
  if (schema.items !== void 0) assertCodeSchema(schema.items, `${path}.items`);
}
function outputKindForCode(schema) {
  assertCodeSchema(schema, "outputSchema");
  const types = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter((type2) => type2 !== "null");
  if (types.length !== 1) schemaError("outputSchema.type", "must contain exactly one non-null type");
  const type = types[0];
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  if (type === "string") return "string";
  return schemaError("outputSchema.type", "null-only outputs cannot be stored in a flow variable");
}
function defineCode(options) {
  const permissions = validateBundleDefinition(options, "Code");
  assertCodeSchema(options.inputSchema, "inputSchema");
  outputKindForCode(options.outputSchema);
  if (typeof options.run !== "function") throw new Error("Code must define run(input, context)");
  return Object.freeze({ ...options, permissions });
}

// src/model.ts
var ID_PATTERN2 = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
var VALUE_REF = /* @__PURE__ */ Symbol("agcomm.ai-sdk.value-ref");
var TEMPLATE = /* @__PURE__ */ Symbol("agcomm.ai-sdk.template");
var APP = /* @__PURE__ */ Symbol("agcomm.ai-sdk.app");
var BRANCH_REF = /* @__PURE__ */ Symbol("agcomm.ai-sdk.branch-ref");
var RESERVED_VARIABLES = /* @__PURE__ */ new Set(["session_id", "conversation_history", "knowledge_context", "background_trigger", "gateway_run_id"]);
var AiSdkError = class extends Error {
  code;
  issues;
  constructor(code, message, issues = [], options) {
    super(message, options);
    this.name = "AiSdkError";
    this.code = code;
    this.issues = issues;
  }
};
function fail(code, message, issue = {}) {
  throw new AiSdkError(code, message, [{ code, message, ...issue }]);
}
function assertId(id, subject) {
  if (!ID_PATTERN2.test(id)) fail("INVALID_ID", `${subject} ID \u201C${id}\u201D \u65E0\u6548`, { path: subject });
}
function defaultFor(kind) {
  if (kind === "number") return 0;
  if (kind === "boolean") return false;
  if (kind === "array") return [];
  if (kind === "object") return {};
  return "";
}
function variableRef(kind, name, value) {
  if (!VARIABLE_PATTERN.test(name)) fail("INVALID_VARIABLE", `\u53D8\u91CF\u540D\u201C${name}\u201D\u65E0\u6548`, { path: name });
  return Object.freeze({ name, kind, defaultValue: value, [VALUE_REF]: "variable" });
}
var variable = {
  string(name, defaultValue = "") {
    return variableRef("string", name, defaultValue);
  },
  markdown(name, defaultValue = "") {
    return variableRef("markdown", name, defaultValue);
  },
  number(name, defaultValue = 0) {
    return variableRef("number", name, defaultValue);
  },
  boolean(name, defaultValue = false) {
    return variableRef("boolean", name, defaultValue);
  },
  array(name, defaultValue = []) {
    return variableRef("array", name, defaultValue);
  },
  object(name, defaultValue = {}) {
    return variableRef("object", name, defaultValue);
  }
};
function isValueRef(value) {
  return Boolean(value && typeof value === "object" && VALUE_REF in value);
}
function isNodeRef(value) {
  return isValueRef(value) && value[VALUE_REF] === "node";
}
function isBranchRef(value) {
  return Boolean(value && typeof value === "object" && BRANCH_REF in value);
}
function isTemplate(value) {
  return Boolean(value && typeof value === "object" && TEMPLATE in value);
}
function template(strings, ...values) {
  let text2 = strings[0] ?? "";
  values.forEach((value, index) => {
    if (isValueRef(value)) text2 += `{{${value.name}}}`;
    else if (isTemplate(value)) text2 += value.text;
    else text2 += String(value ?? "");
    text2 += strings[index + 1] ?? "";
  });
  return Object.freeze({ text: text2, [TEMPLATE]: true });
}
function defineSkill(options) {
  assertId(options.id, "Skill");
  if (!options.name.trim()) fail("INVALID_SKILL", `Skill \u201C${options.id}\u201D \u7F3A\u5C11\u540D\u79F0`);
  return Object.freeze({
    id: options.id,
    name: options.name,
    description: options.description ?? "",
    category: options.category ?? "\u672A\u5206\u7C7B",
    prompt: options.prompt,
    plugins: [...options.plugins ?? []]
  });
}
function encodeDefault(ref) {
  if (ref.kind === "array" || ref.kind === "object") {
    try {
      return JSON.stringify(ref.defaultValue);
    } catch (error) {
      throw new AiSdkError("INVALID_VARIABLE_DEFAULT", `\u53D8\u91CF\u201C${ref.name}\u201D\u7684\u9ED8\u8BA4\u503C\u65E0\u6CD5\u5E8F\u5217\u5316`, [], { cause: error });
    }
  }
  return String(ref.defaultValue ?? "");
}
function serializeValue(value) {
  if (isValueRef(value)) return `{{${value.name}}}`;
  if (isTemplate(value)) return value.text;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]));
  return value;
}
var REFERENCE_PATTERN = /\{\{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\}\}/g;
function collectReferenceNames(value, names = /* @__PURE__ */ new Set()) {
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
function inferredKind(value) {
  if (isValueRef(value)) return value.kind;
  if (isTemplate(value) || typeof value === "string") return "markdown";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return "object";
  return "markdown";
}
function nodeDefaults(type) {
  if (type === "INPUT") return { title: "\u7528\u6237\u8F93\u5165", icon: "\u2328", tone: "blue", note: "\u6536\u96C6\u8FD0\u884C\u53D8\u91CF" };
  if (type === "SKILL") return { title: "\u8C03\u7528 Skill", icon: "\u2726", tone: "violet", note: "\u8C03\u7528 Skill" };
  if (type === "WORKSPACE") return { title: "Agent Workspace", icon: "\u25CE", tone: "cyan", note: "Agent \u81EA\u4E3B\u8C03\u7528 Skills" };
  if (type === "HTTP") return { title: "HTTP \u8BF7\u6C42", icon: "\u2301", tone: "slate", note: "\u53D1\u9001 HTTPS \u8BF7\u6C42" };
  if (type === "CONDITION") return { title: "\u6761\u4EF6\u5206\u652F", icon: "\u25C7", tone: "amber", note: "\u8FD0\u884C\u65F6\u6761\u4EF6\u5224\u65AD" };
  if (type === "CODE") return { title: "TypeScript \u4EE3\u7801", icon: "{ }", tone: "slate", note: "\u6267\u884C\u786E\u5B9A\u6027\u4EE3\u7801" };
  if (type === "CONTACT") return { title: "\u8054\u7CFB\u7528\u6237", icon: "@", tone: "cyan", note: "\u5199\u5165 Inbox \u5E76\u6295\u9012\u901A\u77E5" };
  if (type === "OUTPUT") return { title: "\u8F93\u51FA", icon: "\u2197", tone: "green", note: "\u8FD4\u56DE\u8FD0\u884C\u7ED3\u679C" };
  return { title: "\u5F00\u59CB", icon: "\u25B6", tone: "mint", note: "\u6D41\u7A0B\u5165\u53E3" };
}
var FlowBuilder = class {
  builderId = crypto.randomUUID();
  nodes = [];
  edges = [];
  variables = /* @__PURE__ */ new Map();
  variableProducers = /* @__PURE__ */ new Map();
  explicitPositions = /* @__PURE__ */ new Map();
  skillIds;
  branchConsumers = /* @__PURE__ */ new Map();
  codeDefinitions = /* @__PURE__ */ new Map();
  hookDefinitions = /* @__PURE__ */ new Map();
  lastNodeId = "start";
  constructor(initialVariables, skills) {
    this.skillIds = new Set(skills.map((skill) => skill.id));
    for (const ref of initialVariables) this.registerVariable(ref);
    const defaults = nodeDefaults("START");
    this.nodes.push({ id: "start", title: defaults.title, type: "START", icon: defaults.icon, x: 24, y: 180, tone: defaults.tone, note: defaults.note, outputVar: "" });
  }
  registerVariable(ref) {
    const current = this.variables.get(ref.name);
    if (current && (current.kind !== ref.kind || encodeDefault(current) !== encodeDefault(ref))) {
      fail("DUPLICATE_VARIABLE", `\u53D8\u91CF\u201C${ref.name}\u201D\u4F7F\u7528\u4E86\u51B2\u7A81\u7684\u7C7B\u578B\u6216\u9ED8\u8BA4\u503C`, { path: ref.name });
    }
    if (!current) this.variables.set(ref.name, ref);
  }
  registerValueRefs(value) {
    if (isValueRef(value)) {
      this.registerVariable(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.registerValueRefs(item));
      return;
    }
    if (value && typeof value === "object" && !isTemplate(value)) Object.values(value).forEach((item) => this.registerValueRefs(item));
  }
  outputRef(nodeId, option, kind) {
    const existing = typeof option === "string" ? this.variables.get(option) : option;
    const name = typeof option === "string" ? option : option?.name ?? `${nodeId}_output`;
    if (RESERVED_VARIABLES.has(name)) fail("RESERVED_VARIABLE", `\u8282\u70B9\u201C${nodeId}\u201D\u4E0D\u80FD\u5199\u5165 runtime \u4FDD\u7559\u53D8\u91CF\u201C${name}\u201D`, { nodeId });
    const ref = existing ?? variableRef(kind, name, defaultFor(kind));
    this.registerVariable(ref);
    const producer = this.variableProducers.get(name);
    if (producer && producer !== nodeId) fail("DUPLICATE_OUTPUT", `\u8F93\u51FA\u53D8\u91CF\u201C${name}\u201D\u5DF2\u7531\u8282\u70B9\u201C${producer}\u201D\u5199\u5165`, { nodeId });
    this.variableProducers.set(name, nodeId);
    return Object.freeze({ ...ref, id: nodeId, nodeId, [VALUE_REF]: "node", __builderId: this.builderId });
  }
  resolveDependencies(source, after, nodeId) {
    this.registerValueRefs(source);
    const dependencies = /* @__PURE__ */ new Map();
    for (const name of collectReferenceNames(source)) {
      const producer = this.variableProducers.get(name);
      if (producer) dependencies.set(producer, void 0);
    }
    if (after !== void 0) {
      const refs = Array.isArray(after) ? after : [after];
      for (const ref of refs) {
        if (isBranchRef(ref)) {
          const sourceNode = this.nodes.find((node2) => node2.id === ref.nodeId);
          if (sourceNode?.type !== "CONDITION") fail("INVALID_DEPENDENCY", `\u8282\u70B9\u201C${nodeId}\u201D\u5F15\u7528\u4E86\u65E0\u6548\u7684\u6761\u4EF6\u5206\u652F`, { nodeId });
          const key = `${ref.nodeId}:${ref.condition}`;
          const consumer = this.branchConsumers.get(key);
          if (consumer && consumer !== nodeId) fail("DUPLICATE_BRANCH_CONSUMER", `\u6761\u4EF6\u8282\u70B9\u201C${ref.nodeId}\u201D\u7684 ${ref.condition} \u5206\u652F\u5DF2\u8FDE\u63A5\u8282\u70B9\u201C${consumer}\u201D`, { nodeId });
          this.branchConsumers.set(key, nodeId);
          dependencies.set(ref.nodeId, ref.condition);
          continue;
        }
        if (!isNodeRef(ref) || !this.nodes.some((node2) => node2.id === ref.nodeId)) fail("INVALID_DEPENDENCY", `\u8282\u70B9\u201C${nodeId}\u201D\u5F15\u7528\u4E86\u5176\u4ED6\u6D41\u7A0B\u6216\u5C1A\u672A\u521B\u5EFA\u7684\u4F9D\u8D56`, { nodeId });
        if (this.nodes.find((node2) => node2.id === ref.nodeId)?.type === "CONDITION") fail("CONDITION_BRANCH_REQUIRED", `\u8282\u70B9\u201C${nodeId}\u201D\u5FC5\u987B\u901A\u8FC7 whenTrue() \u6216 whenFalse() \u8FDE\u63A5\u6761\u4EF6\u8282\u70B9`, { nodeId });
        dependencies.set(ref.nodeId, dependencies.get(ref.nodeId));
      }
      if (!dependencies.size) dependencies.set("start", void 0);
    } else if (!dependencies.size) dependencies.set(this.lastNodeId, void 0);
    dependencies.delete(nodeId);
    return [...dependencies].map(([from, condition]) => ({ from, condition }));
  }
  addNode(type, options, config, source, kind, details = {}) {
    assertId(options.id, "Node");
    if (options.id === "start" || this.nodes.some((node2) => node2.id === options.id)) fail("DUPLICATE_NODE", `\u8282\u70B9 ID \u201C${options.id}\u201D \u91CD\u590D`, { nodeId: options.id });
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
      ...options.timeoutMs !== void 0 ? { timeoutMs: executionLimit(options.timeoutMs, 6e5, `\u8282\u70B9\u201C${options.id}\u201D\u7684 timeoutMs`) } : {},
      ...details.workspace ? { workspace: details.workspace } : {}
    });
    if (options.position) this.explicitPositions.set(options.id, options.position);
    for (const dependency of dependencies) {
      const edge = createConnection(dependency.from, options.id, this.edges);
      this.edges.push(dependency.condition ? { ...edge, label: dependency.condition, condition: dependency.condition } : edge);
    }
    this.lastNodeId = options.id;
    return output;
  }
  input(options) {
    if (!options.fields.length) fail("INVALID_INPUT", `\u8F93\u5165\u8282\u70B9\u201C${options.id}\u201D\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u5B57\u6BB5`, { nodeId: options.id });
    const seen = /* @__PURE__ */ new Set();
    for (const field of options.fields) {
      this.registerVariable(field.variable);
      if (seen.has(field.variable.name)) fail("INVALID_INPUT", `\u8F93\u5165\u8282\u70B9\u201C${options.id}\u201D\u91CD\u590D\u4F7F\u7528\u53D8\u91CF\u201C${field.variable.name}\u201D`, { nodeId: options.id });
      seen.add(field.variable.name);
    }
    const fields = options.fields.map((field, index) => ({
      id: `field_${field.variable.name}_${index}`,
      variable: field.variable.name,
      label: field.label,
      component: field.component ?? (field.variable.kind === "boolean" ? "checkbox" : "input"),
      size: field.size ?? (field.variable.kind === "boolean" ? "small" : "large"),
      ...field.placeholder !== void 0 ? { placeholder: field.placeholder } : {},
      ...field.buttonValue !== void 0 ? { buttonValue: field.buttonValue } : {}
    }));
    const result = this.addNode("INPUT", options, { layout: options.layout ?? "single", fields }, [], "object", { note: [...seen].join(", ") });
    for (const name of seen) this.variableProducers.set(name, options.id);
    return result;
  }
  skill(options) {
    if (!this.skillIds.has(options.skill.id)) fail("MISSING_SKILL", `\u8282\u70B9\u201C${options.id}\u201D\u4F7F\u7528\u4E86\u672A\u5728 App \u4E2D\u58F0\u660E\u7684 Skill \u201C${options.skill.id}\u201D`, { nodeId: options.id });
    const input = options.input ?? "{{user_input}}";
    return this.addNode("SKILL", options, { skillId: options.skill.id, input: serializeValue(input) }, input, "markdown", { note: options.skill.id });
  }
  workspace(options) {
    if (!this.skillIds.has(options.agent.id)) fail("MISSING_SKILL", `Workspace\u201C${options.id}\u201D\u7684\u603B Agent Skill \u672A\u5728 App \u4E2D\u58F0\u660E`, { nodeId: options.id });
    if (!options.skills.length) fail("INVALID_WORKSPACE", `Workspace\u201C${options.id}\u201D\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u53EF\u8C03\u7528 Skill`, { nodeId: options.id });
    if (options.skills.some((skill) => skill.id === options.agent.id)) fail("INVALID_WORKSPACE", `Workspace\u201C${options.id}\u201D\u4E0D\u80FD\u628A\u603B Agent \u540C\u65F6\u8BBE\u4E3A\u53EF\u8C03\u7528 Skill`, { nodeId: options.id });
    for (const skill of options.skills) if (!this.skillIds.has(skill.id)) fail("MISSING_SKILL", `Workspace\u201C${options.id}\u201D\u4F7F\u7528\u4E86\u672A\u58F0\u660E\u7684 Skill \u201C${skill.id}\u201D`, { nodeId: options.id });
    const maxIterations = options.maxIterations ?? 6;
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) fail("INVALID_WORKSPACE", `Workspace\u201C${options.id}\u201D\u7684 maxIterations \u5FC5\u987B\u4E3A 1\u201310`, { nodeId: options.id });
    const hooks = [...options.hooks ?? []];
    if (hooks.length > 16) fail("INVALID_WORKSPACE_HOOKS", `Workspace\u201C${options.id}\u201D\u6700\u591A\u58F0\u660E 16 \u4E2A Hook`, { nodeId: options.id });
    const hookIds = /* @__PURE__ */ new Set();
    for (const hook of hooks) {
      if (hookIds.has(hook.id)) fail("DUPLICATE_WORKSPACE_HOOK", `Workspace\u201C${options.id}\u201D\u91CD\u590D\u58F0\u660E Hook \u201C${hook.id}\u201D`, { nodeId: options.id });
      hookIds.add(hook.id);
      const current = this.hookDefinitions.get(hook.id);
      if (current && current !== hook) fail("DUPLICATE_WORKSPACE_HOOK", `Hook ID \u201C${hook.id}\u201D\u5F15\u7528\u4E86\u4E0D\u540C\u5B9A\u4E49`, { nodeId: options.id });
      this.hookDefinitions.set(hook.id, hook);
    }
    const input = options.input ?? "{{user_input}}";
    const workspace = { agentSkillId: options.agent.id, skillIds: options.skills.map((skill) => skill.id), maxIterations };
    return this.addNode("WORKSPACE", options, { ...workspace, input: serializeValue(input), ...hooks.length ? { hookIds: hooks.map((hook) => hook.id) } : {} }, input, "markdown", { workspace, note: `${options.agent.id} \xB7 ${options.skills.length} Skills` });
  }
  http(options) {
    const source = { url: options.url, headers: options.headers, body: options.body };
    return this.addNode("HTTP", options, {
      method: options.method ?? "GET",
      url: serializeValue(options.url),
      ...options.headers === void 0 ? {} : { headers: serializeValue(options.headers) },
      ...options.body === void 0 ? {} : { body: serializeValue(options.body) }
    }, source, "object");
  }
  condition(options) {
    const expression = String(serializeValue(options.expression));
    const error = validateExpression(expression);
    if (error) fail("INVALID_CONDITION", `\u6761\u4EF6\u8282\u70B9\u201C${options.id}\u201D\u8868\u8FBE\u5F0F\u65E0\u6548\uFF1A${error}`, { nodeId: options.id });
    const output = this.addNode("CONDITION", options, { expression }, options.expression, "boolean");
    const branch = (condition) => Object.freeze({
      nodeId: output.nodeId,
      condition,
      [BRANCH_REF]: true
    });
    return Object.freeze({ ...output, whenTrue: () => branch("true"), whenFalse: () => branch("false") });
  }
  code(options) {
    const current = this.codeDefinitions.get(options.code.id);
    if (current && current !== options.code) fail("DUPLICATE_CODE", `Code ID \u201C${options.code.id}\u201D\u5F15\u7528\u4E86\u4E0D\u540C\u5B9A\u4E49`, { path: options.code.id });
    this.codeDefinitions.set(options.code.id, options.code);
    return this.addNode("CODE", options, { codeId: options.code.id, input: serializeValue(options.input) }, options.input, outputKindForCode(options.code.outputSchema), { note: options.code.id });
  }
  contact(options) {
    const source = { title: options.title, body: options.body, dedupeKey: options.dedupeKey };
    return this.addNode("CONTACT", options, {
      title: serializeValue(options.title),
      body: serializeValue(options.body),
      severity: options.severity ?? "info",
      webhook: options.webhook === true,
      ...options.dedupeKey === void 0 ? {} : { dedupeKey: serializeValue(options.dedupeKey) }
    }, source, "object");
  }
  output(options) {
    const value = options.value ?? template`{{previous.output}}`;
    return this.addNode("OUTPUT", options, { template: serializeValue(value) }, value, inferredKind(value));
  }
  finish(name, skills, visualizations, interaction, identity, execution) {
    const layout = autoLayoutNodes(this.nodes, this.edges).map((node2) => {
      const position = this.explicitPositions.get(node2.id);
      return position ? { ...node2, ...position } : node2;
    });
    return {
      name,
      ...identity?.id ? { appId: identity.id } : {},
      ...identity?.version ? { appVersion: identity.version } : {},
      ...interaction ? { interaction } : {},
      ...identity?.background ? { background: identity.background } : {},
      ...execution ? { execution } : {},
      nodes: layout,
      edges: this.edges,
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        prompt: isTemplate(skill.prompt) ? skill.prompt.text : skill.prompt,
        pluginIds: skill.plugins.map((plugin2) => plugin2.id)
      })),
      variables: [...this.variables.values()].map((ref) => ({ name: ref.name, type: ref.kind, defaultValue: encodeDefault(ref) })),
      visualizations: [...visualizations]
    };
  }
  codes() {
    return [...this.codeDefinitions.values()];
  }
  hooks() {
    return [...this.hookDefinitions.values()];
  }
};
function uniqueById(values, subject) {
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    assertId(value.id, subject);
    if (seen.has(value.id)) fail(`DUPLICATE_${subject.toUpperCase()}`, `${subject} ID \u201C${value.id}\u201D \u91CD\u590D`, { path: value.id });
    seen.add(value.id);
  }
}
function defineApp(options, build2) {
  if (!options.name.trim()) fail("INVALID_APP", "App \u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
  const background = normalizeBackground(options.background, options.id, options.version);
  for (const ref of options.variables ?? []) if (RESERVED_VARIABLES.has(ref.name)) fail("RESERVED_VARIABLE", `\u53D8\u91CF\u201C${ref.name}\u201D\u7531 runtime \u4FDD\u7559\uFF0C\u4E0D\u80FD\u81EA\u884C\u58F0\u660E`, { path: ref.name });
  const interaction = normalizeInteraction(options.interaction);
  const execution = options.timeoutMs !== void 0 || options.maxConcurrency !== void 0 ? {
    ...options.timeoutMs !== void 0 ? { timeoutMs: executionLimit(options.timeoutMs, 6e5, "App timeoutMs") } : {},
    ...options.maxConcurrency !== void 0 ? { maxConcurrency: executionLimit(options.maxConcurrency, 32, "App maxConcurrency") } : {}
  } : void 0;
  const skills = [...options.skills ?? []];
  uniqueById(skills, "skill");
  const flowHooks = [...options.hooks ?? []];
  const flowHookIds = /* @__PURE__ */ new Set();
  for (const hook of flowHooks) {
    assertId(hook.id, "Flow Hook");
    if (flowHookIds.has(hook.id)) fail("DUPLICATE_FLOW_HOOK", `Flow Hook ID \u201C${hook.id}\u201D\u91CD\u590D`, { path: hook.id });
    flowHookIds.add(hook.id);
  }
  if (flowHooks.length > 16) fail("INVALID_FLOW_HOOKS", "App \u6700\u591A\u58F0\u660E 16 \u4E2A Flow Hook");
  const configuredPlugins = [...options.plugins ?? []];
  const inferredPlugins = skills.flatMap((skill) => [...skill.plugins]);
  const pluginsById = /* @__PURE__ */ new Map();
  for (const plugin2 of [...configuredPlugins, ...inferredPlugins]) {
    const current = pluginsById.get(plugin2.id);
    if (current && current !== plugin2) fail("DUPLICATE_PLUGIN", `Plugin ID \u201C${plugin2.id}\u201D\u5F15\u7528\u4E86\u4E0D\u540C\u5B9A\u4E49`, { path: plugin2.id });
    pluginsById.set(plugin2.id, plugin2);
  }
  const runtimeVariables = interaction ? [
    variable.string("session_id"),
    variable.array("conversation_history"),
    variable.markdown("knowledge_context")
  ] : [];
  if (background) runtimeVariables.push(
    variable.object("background_trigger", { type: "manual" }),
    variable.string("gateway_run_id")
  );
  const flow2 = new FlowBuilder([...options.variables ?? [], ...runtimeVariables], skills);
  const result = build2({ flow: flow2 });
  if (result && typeof result.then === "function") {
    fail("ASYNC_BUILDER_UNSUPPORTED", "defineApp() \u7684\u6D41\u7A0B Builder \u5FC5\u987B\u540C\u6B65\u6267\u884C\uFF1B\u5F02\u6B65\u5DE5\u4F5C\u5E94\u653E\u5728\u6784\u5EFA\u811A\u672C\u8C03\u7528 writeAi() \u4E4B\u524D");
  }
  const prepared = {
    project: {
      ...flow2.finish(options.name, skills, options.visualizations ?? [], interaction, { id: options.id, version: options.version, background }, execution),
      ...flowHooks.length ? { flowHookIds: flowHooks.map((hook) => hook.id) } : {}
    },
    plugins: [...pluginsById.values()],
    codes: flow2.codes(),
    hooks: flow2.hooks(),
    flowHooks
  };
  validateBackgroundFlow(prepared.project, background);
  return Object.freeze({ id: options.id, version: options.version, name: options.name, prepared, [APP]: true });
}
function executionLimit(value, maximum, subject) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail("INVALID_EXECUTION_LIMIT", `${subject} \u5FC5\u987B\u4E3A 1\u2013${maximum} \u7684\u6574\u6570`);
  return value;
}
function jsonClone(value, subject) {
  try {
    const encoded = JSON.stringify(value ?? {});
    if (encoded.length > 65536) fail("INVALID_BACKGROUND", `${subject} \u8D85\u8FC7 64 KiB`);
    return JSON.parse(encoded);
  } catch (error) {
    if (error instanceof AiSdkError) throw error;
    fail("INVALID_BACKGROUND", `${subject} \u5FC5\u987B\u662F\u53EF\u5E8F\u5217\u5316 JSON`);
  }
}
function normalizeBackground(value, appId, version) {
  if (!value) return void 0;
  if (!appId) fail("BACKGROUND_APP_ID_REQUIRED", "\u540E\u53F0\u5E94\u7528\u5FC5\u987B\u58F0\u660E\u7A33\u5B9A id");
  assertId(appId, "App");
  if (!version || version.length > 32 || !/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version)) fail("BACKGROUND_VERSION_REQUIRED", "\u540E\u53F0\u5E94\u7528\u5FC5\u987B\u58F0\u660E\u6709\u6548 version");
  if (!value.heartbeat && !value.cron?.length) fail("BACKGROUND_TRIGGER_REQUIRED", "background \u81F3\u5C11\u9700\u8981 heartbeat \u6216 cron \u89E6\u53D1\u5668");
  const historyWindow = value.historyWindow ?? 20;
  if (!Number.isInteger(historyWindow) || historyWindow < 1 || historyWindow > 100) fail("INVALID_BACKGROUND", "background.historyWindow \u5FC5\u987B\u4E3A 1\u2013100");
  const ids = /* @__PURE__ */ new Set();
  const register = (id) => {
    assertId(id, "Background trigger");
    if (ids.has(id)) fail("DUPLICATE_BACKGROUND_TRIGGER", `\u540E\u53F0\u89E6\u53D1\u5668 ID \u201C${id}\u201D\u91CD\u590D`);
    ids.add(id);
  };
  const heartbeat = value.heartbeat ? (() => {
    register(value.heartbeat.id);
    if (!Number.isInteger(value.heartbeat.everyMs) || value.heartbeat.everyMs < 6e4 || value.heartbeat.everyMs > 864e5) fail("INVALID_HEARTBEAT", "heartbeat.everyMs \u5FC5\u987B\u4E3A 60000\u201386400000");
    return { id: value.heartbeat.id, everyMs: value.heartbeat.everyMs, input: value.heartbeat.input, variables: jsonClone(value.heartbeat.variables, "heartbeat.variables"), runOnStart: value.heartbeat.runOnStart === true };
  })() : void 0;
  if ((value.cron?.length ?? 0) > 64) fail("INVALID_CRON", "background.cron \u6700\u591A\u5305\u542B 64 \u4E2A\u89E6\u53D1\u5668");
  const cron = (value.cron ?? []).map((trigger) => {
    register(trigger.id);
    try {
      parseCronExpression(trigger.expression);
      assertTimeZone(trigger.timezone);
      nextCronOccurrence(trigger.expression, trigger.timezone, /* @__PURE__ */ new Date());
    } catch (error) {
      fail("INVALID_CRON", `Cron\u201C${trigger.id}\u201D\u65E0\u6548\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    const misfireGraceMs = trigger.misfireGraceMs ?? 9e5;
    if (!Number.isInteger(misfireGraceMs) || misfireGraceMs < 0 || misfireGraceMs > 864e5) fail("INVALID_CRON", `Cron\u201C${trigger.id}\u201D\u7684 misfireGraceMs \u5FC5\u987B\u4E3A 0\u201386400000`);
    return { id: trigger.id, expression: trigger.expression.trim(), timezone: trigger.timezone, input: trigger.input, variables: jsonClone(trigger.variables, `cron.${trigger.id}.variables`), misfireGraceMs };
  });
  return { historyWindow, ...heartbeat ? { heartbeat } : {}, ...cron.length ? { cron } : {} };
}
function validateBackgroundFlow(project, background) {
  const contacts = project.nodes.filter((node2) => node2.type === "CONTACT");
  if (contacts.length && !background) fail("CONTACT_REQUIRES_BACKGROUND", "flow.contact() \u8981\u6C42 defineApp() \u58F0\u660E background", { nodeId: contacts[0].id });
  if (!background) return;
  const definitions = new Map(project.variables.map((variable2) => [variable2.name, variable2]));
  const triggers = [...background.heartbeat ? [background.heartbeat] : [], ...background.cron ?? []];
  for (const node2 of project.nodes.filter((item) => item.type === "INPUT")) {
    const fields = Array.isArray(node2.config?.fields) ? node2.config.fields : [];
    for (const trigger of triggers) for (const field of fields) {
      const name = String(field.variable ?? "");
      const supplied = Object.hasOwn(trigger.variables ?? {}, name) || name === "user_input" && trigger.input.length > 0;
      const definition = definitions.get(name);
      const hasDefault = definition !== void 0 && (definition.type === "boolean" || definition.type === "number" || definition.defaultValue !== "");
      if (!supplied && !hasDefault) fail("BACKGROUND_INPUT_REQUIRED", `\u89E6\u53D1\u5668\u201C${trigger.id}\u201D\u672A\u63D0\u4F9B INPUT \u53D8\u91CF\u201C${name}\u201D`, { nodeId: node2.id });
    }
  }
}
function normalizeInteraction(value) {
  if (!value) return void 0;
  const history = value.conversation?.history === true;
  const conversation = value.conversation ? {
    multiTurn: history || value.conversation.multiTurn === true,
    history,
    historyWindow: value.conversation.historyWindow ?? 20
  } : void 0;
  const knowledge = value.knowledge ? {
    enabled: true,
    scopes: [...value.knowledge.scopes ?? ["app"]],
    topK: value.knowledge.topK ?? 6,
    chunkSize: value.knowledge.chunkSize ?? 1200,
    chunkOverlap: value.knowledge.chunkOverlap ?? 200
  } : void 0;
  const streaming = value.streaming ? { defaultMode: value.streaming.defaultMode } : void 0;
  if (conversation && (!Number.isInteger(conversation.historyWindow) || conversation.historyWindow < 1 || conversation.historyWindow > 100)) fail("INVALID_INTERACTION", "conversation.historyWindow \u5FC5\u987B\u4E3A 1\u2013100");
  if (knowledge && (!Number.isInteger(knowledge.topK) || knowledge.topK < 1 || knowledge.topK > 20)) fail("INVALID_INTERACTION", "knowledge.topK \u5FC5\u987B\u4E3A 1\u201320");
  if (knowledge && (!Number.isInteger(knowledge.chunkSize) || knowledge.chunkSize < 200 || knowledge.chunkSize > 8e3)) fail("INVALID_INTERACTION", "knowledge.chunkSize \u5FC5\u987B\u4E3A 200\u20138000");
  if (knowledge && (!Number.isInteger(knowledge.chunkOverlap) || knowledge.chunkOverlap < 0 || knowledge.chunkOverlap > 2e3)) fail("INVALID_INTERACTION", "knowledge.chunkOverlap \u5FC5\u987B\u4E3A 0\u20132000");
  if (knowledge?.scopes.includes("session") && !history) fail("SESSION_KNOWLEDGE_REQUIRES_HISTORY", "\u4F1A\u8BDD\u7EA7\u77E5\u8BC6\u5E93\u8981\u6C42 conversation.history=true");
  if (knowledge && knowledge.chunkOverlap >= knowledge.chunkSize) fail("INVALID_INTERACTION", "knowledge.chunkOverlap \u5FC5\u987B\u5C0F\u4E8E chunkSize");
  if (streaming && streaming.defaultMode !== "text" && streaming.defaultMode !== "events") fail("INVALID_INTERACTION", "streaming.defaultMode \u5FC5\u987B\u4E3A text \u6216 events");
  return { ...conversation ? { conversation } : {}, ...knowledge ? { knowledge } : {}, ...streaming ? { streaming } : {} };
}
function preparedApp(app) {
  if (!app || typeof app !== "object" || !(APP in app)) fail("INVALID_APP", "\u9700\u8981\u7531 defineApp() \u521B\u5EFA\u7684 AppDefinition");
  return app.prepared;
}

// src/hook.ts
var WORKSPACE_HOOK_OPERATIONS = ["onStart", "beforeModel", "afterModel", "beforeTool", "afterTool", "onFinish", "onError"];
var VALUE_SCHEMA = { type: ["null", "boolean", "number", "string", "array", "object"] };
var VARIABLES_SCHEMA = { type: "object" };
var COMMON_PROPERTIES = { state: VALUE_SCHEMA, variables: VARIABLES_SCHEMA };
function objectResult(properties) {
  return { type: ["object", "null"], properties: { ...COMMON_PROPERTIES, ...properties }, additionalProperties: false };
}
var WORKSPACE_HOOK_SCHEMAS = Object.freeze({
  onStart: { inputSchema: { type: "object" }, outputSchema: objectResult({ input: { type: "string" } }) },
  beforeModel: { inputSchema: { type: "object" }, outputSchema: objectResult({ systemInstruction: { type: "string", maxLength: 65536 } }) },
  afterModel: { inputSchema: { type: "object" }, outputSchema: objectResult({ content: { type: "string" } }) },
  beforeTool: { inputSchema: { type: "object" }, outputSchema: objectResult({ input: VALUE_SCHEMA, skipWith: { type: "string" } }) },
  afterTool: { inputSchema: { type: "object" }, outputSchema: objectResult({ output: { type: "string" } }) },
  onFinish: { inputSchema: { type: "object" }, outputSchema: objectResult({ output: { type: "string" } }) },
  onError: { inputSchema: { type: "object" }, outputSchema: { type: "null" } }
});
function defineWorkspaceHook(options) {
  const permissions = validateBundleDefinition(options, "Workspace Hook");
  const operations = WORKSPACE_HOOK_OPERATIONS.filter((operation) => typeof options.handlers[operation] === "function");
  if (!operations.length) throw new Error("Workspace Hook must define at least one handler");
  const tools = createHandlerTools(operations, options.handlers, WORKSPACE_HOOK_SCHEMAS, permissions, "Workspace Hook");
  return Object.freeze({ ...options, permissions, handlers: Object.freeze({ ...options.handlers }), tools: Object.freeze(tools) });
}

// src/flow-hook.ts
var FLOW_HOOK_OPERATIONS = ["beforeNode", "afterNode", "onNodeError"];
var VALUE_SCHEMA2 = { type: ["null", "boolean", "number", "string", "array", "object"] };
var COMMON_PROPERTIES2 = { state: VALUE_SCHEMA2 };
var objectResult2 = (properties) => ({
  type: ["object", "null"],
  properties: { ...COMMON_PROPERTIES2, ...properties },
  additionalProperties: false
});
var FLOW_HOOK_SCHEMAS = Object.freeze({
  beforeNode: { inputSchema: { type: "object" }, outputSchema: objectResult2({ config: { type: "object" }, skipWith: VALUE_SCHEMA2 }) },
  afterNode: { inputSchema: { type: "object" }, outputSchema: objectResult2({ output: VALUE_SCHEMA2 }) },
  onNodeError: { inputSchema: { type: "object" }, outputSchema: objectResult2({ recoverWith: VALUE_SCHEMA2 }) }
});
function defineFlowHook(options) {
  const permissions = validateBundleDefinition(options, "Flow Hook");
  const operations = FLOW_HOOK_OPERATIONS.filter((operation) => typeof options.handlers[operation] === "function");
  if (!operations.length) throw new Error("Flow Hook must define at least one handler");
  const tools = createHandlerTools(operations, options.handlers, FLOW_HOOK_SCHEMAS, permissions, "Flow Hook");
  return Object.freeze({ ...options, permissions, handlers: Object.freeze({ ...options.handlers }), tools: Object.freeze(tools) });
}

// src/build.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// ../../lib/flow-runtime/validation.ts
function edgeId(edge, index) {
  return edge.id?.trim() || `${edge.from}->${edge.to}#${index}`;
}
function normalizeEdges(edges) {
  return edges.map((edge, index) => ({ ...edge, id: edgeId(edge, index) }));
}
function findCycle(nodes, edges) {
  const ids = new Set(nodes.map((node2) => node2.id));
  const adjacency = /* @__PURE__ */ new Map();
  for (const node2 of nodes) adjacency.set(node2.id, []);
  for (const edge of edges) if (ids.has(edge.from) && ids.has(edge.to)) adjacency.get(edge.from)?.push(edge.to);
  const state = /* @__PURE__ */ new Map();
  const stack = [];
  let found = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      if (state.get(next) === 1) {
        const start = stack.lastIndexOf(next);
        found = [...stack.slice(start), next];
        return true;
      }
      if (!state.get(next) && visit(next)) return true;
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };
  for (const node2 of nodes) if (!state.get(node2.id) && visit(node2.id)) break;
  return found;
}
function validateFlow(flow2) {
  const issues = [];
  const nodeCounts = /* @__PURE__ */ new Map();
  for (const node2 of flow2.nodes) nodeCounts.set(node2.id, (nodeCounts.get(node2.id) ?? 0) + 1);
  for (const [id, count] of nodeCounts) {
    if (!id.trim()) issues.push({ code: "INVALID_NODE", severity: "error", nodeId: id, message: "\u8282\u70B9 ID \u4E0D\u80FD\u4E3A\u7A7A" });
    if (count > 1) issues.push({ code: "DUPLICATE_NODE_ID", severity: "error", nodeId: id, message: `\u8282\u70B9 ID\u201C${id}\u201D\u91CD\u590D` });
  }
  const nodeMap = new Map(flow2.nodes.map((node2) => [node2.id, node2]));
  const starts = flow2.nodes.filter((node2) => node2.type === "START");
  if (starts.length !== 1) issues.push({ code: "START_COUNT", severity: "error", message: `\u6D41\u7A0B\u5FC5\u987B\u4E14\u53EA\u80FD\u6709\u4E00\u4E2A Start \u8282\u70B9\uFF0C\u5F53\u524D\u4E3A ${starts.length} \u4E2A` });
  const entry = flow2.entry?.trim() || starts[0]?.id;
  if (!entry) issues.push({ code: "ENTRY_MISSING", severity: "error", message: "\u6D41\u7A0B\u7F3A\u5C11\u5165\u53E3\u8282\u70B9" });
  else if (!nodeMap.has(entry)) issues.push({ code: "ENTRY_INVALID", severity: "error", nodeId: entry, message: `\u5165\u53E3\u8282\u70B9\u201C${entry}\u201D\u4E0D\u5B58\u5728` });
  else if (nodeMap.get(entry)?.type !== "START") issues.push({ code: "ENTRY_INVALID", severity: "error", nodeId: entry, message: `\u5165\u53E3\u8282\u70B9\u201C${entry}\u201D\u5FC5\u987B\u662F START \u7C7B\u578B` });
  else if (starts.length === 1 && starts[0].id !== entry) issues.push({ code: "ENTRY_INVALID", severity: "error", nodeId: entry, message: "entry \u5FC5\u987B\u6307\u5411\u552F\u4E00\u7684 START \u8282\u70B9" });
  const normalizedEdges = normalizeEdges(flow2.edges);
  const explicitEdgeIds = flow2.edges.filter((edge) => edge.id).map((edge) => edge.id);
  const seenEdges = /* @__PURE__ */ new Set();
  for (const id of explicitEdgeIds) {
    if (seenEdges.has(id)) issues.push({ code: "DUPLICATE_EDGE_ID", severity: "error", edgeId: id, message: `\u8FB9 ID\u201C${id}\u201D\u91CD\u590D` });
    seenEdges.add(id);
  }
  normalizedEdges.forEach((edge) => {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      issues.push({ code: "DANGLING_EDGE", severity: "error", edgeId: edge.id, message: `\u8FB9\u201C${edge.id}\u201D\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u8282\u70B9` });
    }
    if (edge.condition) {
      const source = nodeMap.get(edge.from);
      if (source && source.type !== "CONDITION") issues.push({ code: "INVALID_CONDITION", severity: "error", edgeId: edge.id, nodeId: source.id, message: `\u6761\u4EF6\u8FB9\u201C${edge.id}\u201D\u5FC5\u987B\u4ECE CONDITION \u8282\u70B9\u53D1\u51FA` });
      const configExpression = typeof source?.config?.expression === "string" ? source.config.expression.trim() : "";
      const isBooleanBranch = configExpression && ["true", "false", "default", "else"].includes(edge.condition.trim().toLowerCase());
      const error = isBooleanBranch ? void 0 : validateExpression(edge.condition);
      if (error) issues.push({ code: "INVALID_CONDITION", severity: "error", edgeId: edge.id, message: `\u6761\u4EF6\u8FB9\u201C${edge.id}\u201D\u65E0\u6548\uFF1A${error}` });
    }
  });
  for (const node2 of flow2.nodes.filter((item) => item.type === "CONDITION")) {
    const expression = typeof node2.config?.expression === "string" ? node2.config.expression : "";
    if (expression) {
      const error = validateExpression(expression);
      if (error) issues.push({ code: "INVALID_CONDITION", severity: "error", nodeId: node2.id, message: `Condition\u201C${node2.id}\u201D\u65E0\u6548\uFF1A${error}` });
    }
  }
  const cycleNodeIds = findCycle(flow2.nodes, flow2.edges);
  if (cycleNodeIds.length) {
    const controlled = Boolean(flow2.config?.loop?.enabled && flow2.config.loop.maxIterations > 0);
    issues.push({ code: "CYCLE", severity: controlled ? "warning" : "error", nodeId: cycleNodeIds[0], message: controlled ? `\u68C0\u6D4B\u5230\u73AF ${cycleNodeIds.join(" \u2192 ")}\uFF0C\u5C06\u6309\u53D7\u63A7\u5FAA\u73AF\u7B56\u7565\u6267\u884C` : `\u68C0\u6D4B\u5230\u73AF ${cycleNodeIds.join(" \u2192 ")}\uFF1B\u8BF7\u79FB\u9664\u73AF\u6216\u914D\u7F6E\u53D7\u63A7\u5FAA\u73AF` });
  }
  const reachable = /* @__PURE__ */ new Set();
  if (entry && nodeMap.has(entry)) {
    const queue = [entry];
    while (queue.length) {
      const id = queue.shift();
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of flow2.edges) if (edge.from === id && nodeMap.has(edge.to)) queue.push(edge.to);
    }
  }
  for (const node2 of flow2.nodes) if (!reachable.has(node2.id)) issues.push({ code: "UNREACHABLE_NODE", severity: "error", nodeId: node2.id, message: `\u8282\u70B9\u201C${node2.id}\u201D\u4ECE\u5165\u53E3\u4E0D\u53EF\u8FBE` });
  if (![...reachable].some((id) => nodeMap.get(id)?.type === "OUTPUT")) issues.push({ code: "OUTPUT_MISSING", severity: "error", message: "\u6D41\u7A0B\u5FC5\u987B\u5305\u542B\u81F3\u5C11\u4E00\u4E2A\u53EF\u8FBE\u7684 OUTPUT \u8282\u70B9" });
  return { valid: !issues.some((issue) => issue.severity === "error"), issues, entry, reachableNodeIds: [...reachable], cycleNodeIds };
}

// ../../domain/flow/input-form.ts
var COMPONENTS = /* @__PURE__ */ new Set(["input", "checkbox", "button"]);
var SIZES = /* @__PURE__ */ new Set(["small", "medium", "large"]);
var LAYOUTS = /* @__PURE__ */ new Set(["single", "two-column", "three-column"]);
function text(value, fallback = "") {
  return typeof value === "string" ? value.slice(0, 160) : fallback;
}
function createInputField(variable2, index = 0) {
  const component = variable2.type === "boolean" ? "checkbox" : "input";
  return {
    id: `field_${variable2.name}_${index}`,
    variable: variable2.name,
    label: variable2.name,
    component,
    size: component === "checkbox" ? "small" : "large",
    placeholder: component === "input" ? `\u8BF7\u8F93\u5165 ${variable2.name}` : void 0
  };
}
function readInputForm(node2, variables) {
  const config = node2.config ?? {};
  const layoutValue = config.layout;
  const layout = typeof layoutValue === "string" && LAYOUTS.has(layoutValue) ? layoutValue : "single";
  const variableMap = new Map(variables.map((variable2) => [variable2.name, variable2]));
  const hasFieldConfig = Array.isArray(config.fields);
  const rawFields = hasFieldConfig ? config.fields.slice(0, 64) : [];
  const fields = rawFields.flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const raw = value;
    const variable2 = text(raw.variable);
    if (!variableMap.has(variable2)) return [];
    const component = typeof raw.component === "string" && COMPONENTS.has(raw.component) ? raw.component : "input";
    const size = typeof raw.size === "string" && SIZES.has(raw.size) ? raw.size : "medium";
    return [{
      id: text(raw.id, `field_${variable2}_${index}`),
      variable: variable2,
      label: text(raw.label, variable2),
      component,
      size,
      ...component === "input" ? { placeholder: text(raw.placeholder, `\u8BF7\u8F93\u5165 ${variable2}`) } : {},
      ...component === "button" ? { buttonValue: text(raw.buttonValue, "true") } : {}
    }];
  });
  if (hasFieldConfig) return { layout, fields };
  const legacyName = text(config.variable, node2.outputVar || "user_input");
  const legacyVariable = variableMap.get(legacyName) ?? variables.find((variable2) => variable2.name === "user_input") ?? variables[0];
  return { layout, fields: legacyVariable ? [createInputField(legacyVariable)] : [] };
}

// ../../domain/flow/compiler.ts
function compileNode(project, node2) {
  const inputConfig = node2.type === "INPUT" ? readInputForm(node2, project.variables) : void 0;
  return {
    id: node2.id,
    type: node2.type,
    title: node2.title,
    outputVar: node2.outputVar || void 0,
    timeoutMs: 3e4,
    retry: { maxAttempts: 2, delayMs: 500, backoff: "exponential" },
    onError: "stop",
    config: node2.type === "SKILL" ? { ...node2.config, skillId: String(node2.config?.skillId || node2.note.split(" \xB7 ")[0]), input: node2.config?.input ?? "{{user_input}}" } : node2.type === "WORKSPACE" ? { ...node2.config, agentSkillId: node2.workspace?.agentSkillId, skillIds: node2.workspace?.skillIds, maxIterations: node2.workspace?.maxIterations, input: node2.config?.input ?? "{{user_input}}" } : node2.type === "INPUT" && inputConfig ? { ...node2.config, layout: inputConfig.layout, fields: inputConfig.fields.map((field) => ({ ...field, variableType: project.variables.find((variable2) => variable2.name === field.variable)?.type ?? "string" })) } : node2.config
  };
}
function compileFlow(project) {
  return {
    entry: project.nodes.find((node2) => node2.type === "START")?.id,
    nodes: project.nodes.map((node2) => compileNode(project, node2)),
    edges: project.edges.map((edge, index) => ({ ...edge, id: edge.id || `edge_${index}` })),
    config: { timeoutMs: 6e4, maxConcurrency: 3, onError: "stop" }
  };
}

// ../../domain/package/zip.ts
var AI_PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 16 * 1024 * 1024,
  entryCount: 512,
  entryCompressedBytes: 4 * 1024 * 1024,
  entryUncompressedBytes: 8 * 1024 * 1024,
  totalUncompressedBytes: 32 * 1024 * 1024,
  pathBytes: 240
});
var AiPackageZipError = class extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "AiPackageZipError";
    this.code = code;
  }
};
function fail2(code, message, cause) {
  throw new AiPackageZipError(code, message, cause === void 0 ? void 0 : { cause });
}
function crc32(data) {
  let crc = 4294967295;
  for (const byte of data) {
    crc ^= byte;
    for (let index = 0; index < 8; index++) crc = crc >>> 1 ^ 3988292384 & -(crc & 1);
  }
  return (crc ^ 4294967295) >>> 0;
}
function hasRange(start, length, end) {
  return Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= 0 && length >= 0 && start <= end && length <= end - start;
}
function requireRange(start, length, end, message) {
  if (!hasRange(start, length, end)) fail2("INVALID_ZIP", message);
}
function decodeUtf8(decoder, bytes, subject) {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    fail2("INVALID_UTF8", `${subject} \u4E0D\u662F\u6709\u6548\u7684 UTF-8`, error);
  }
}
function validatePath(name, byteLength) {
  if (!byteLength || byteLength > AI_PACKAGE_LIMITS.pathBytes) fail2("INVALID_PATH", `ZIP \u6761\u76EE\u8DEF\u5F84\u957F\u5EA6\u65E0\u6548\uFF1A${byteLength} bytes`);
  if (name.includes("\0")) fail2("INVALID_PATH", "ZIP \u6761\u76EE\u8DEF\u5F84\u5305\u542B NUL \u5B57\u7B26");
  if (name.includes("\\")) fail2("INVALID_PATH", `ZIP \u6761\u76EE\u8DEF\u5F84\u4E0D\u80FD\u5305\u542B\u53CD\u659C\u6760\uFF1A${name}`);
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) fail2("INVALID_PATH", `ZIP \u6761\u76EE\u4E0D\u80FD\u4F7F\u7528\u7EDD\u5BF9\u8DEF\u5F84\uFF1A${name}`);
  if (name !== name.normalize("NFC")) fail2("INVALID_PATH", `ZIP \u6761\u76EE\u8DEF\u5F84\u5FC5\u987B\u4F7F\u7528 NFC \u7F16\u7801\uFF1A${name}`);
  const path = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = path.split("/");
  if (!path || segments.some((segment) => !segment || segment === "." || segment === "..")) fail2("INVALID_PATH", `ZIP \u6761\u76EE\u8DEF\u5F84\u4E0D\u5B89\u5168\uFF1A${name}`);
}
function isMacOsMetadataPath(name) {
  const path = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = path.split("/");
  return segments[0] === "__MACOSX" || segments.some((segment) => segment === ".DS_Store" || segment.startsWith("._"));
}
async function inflateRaw(payload, expectedSize, remainingTotal) {
  let stream;
  try {
    const source = new Blob([Uint8Array.from(payload).buffer]).stream();
    stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  } catch (error) {
    fail2("INVALID_ZIP", "\u65E0\u6CD5\u521D\u59CB\u5316 ZIP Deflate \u89E3\u538B", error);
  }
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      length += chunk.byteLength;
      if (length > AI_PACKAGE_LIMITS.entryUncompressedBytes || length > remainingTotal) {
        await reader.cancel();
        fail2("ENTRY_UNCOMPRESSED_TOO_LARGE", "ZIP \u6761\u76EE\u7684\u5B9E\u9645\u89E3\u538B\u5927\u5C0F\u8D85\u8FC7\u5B89\u5168\u9650\u5236");
      }
      if (length > expectedSize) {
        await reader.cancel();
        fail2("SIZE_MISMATCH", "ZIP \u6761\u76EE\u7684\u5B9E\u9645\u89E3\u538B\u5927\u5C0F\u8D85\u8FC7\u58F0\u660E\u503C");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof AiPackageZipError) throw error;
    fail2("INVALID_ZIP", "ZIP Deflate \u6570\u636E\u635F\u574F", error);
  } finally {
    reader.releaseLock();
  }
  if (length !== expectedSize) fail2("SIZE_MISMATCH", `ZIP \u6761\u76EE\u58F0\u660E\u89E3\u538B\u5927\u5C0F\u4E3A ${expectedSize}\uFF0C\u5B9E\u9645\u4E3A ${length}`);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
function createZip(files) {
  const encoder2 = new TextEncoder();
  const chunks = [];
  const directory = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder2.encode(name);
    const body = encoder2.encode(content);
    const checksum = crc32(body);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 67324752, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 2048, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, body.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, body);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 33639248, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 2048, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, body.length, true);
    centralView.setUint32(24, body.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    directory.push(central);
    offset += local.length + body.length;
  }
  const directorySize = directory.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 101010256, true);
  endView.setUint16(8, directory.length, true);
  endView.setUint16(10, directory.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end].map((chunk) => Uint8Array.from(chunk).buffer), { type: "application/x-ai-package" });
}
async function readZip(buffer) {
  if (buffer.byteLength > AI_PACKAGE_LIMITS.archiveBytes) fail2("ARCHIVE_TOO_LARGE", `.ai \u5305\u4E0D\u80FD\u8D85\u8FC7 ${AI_PACKAGE_LIMITS.archiveBytes} bytes`);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const pathDecoder = new TextDecoder("utf-8", { fatal: true });
  const contentDecoder = new TextDecoder("utf-8", { fatal: true });
  if (bytes.byteLength < 22) fail2("INVALID_ZIP", "ZIP \u76EE\u5F55\u4E0D\u5B8C\u6574");
  let end = -1;
  const firstCandidate = Math.max(0, bytes.length - 22 - 65535);
  for (let candidate = bytes.length - 22; candidate >= firstCandidate; candidate--) {
    if (view.getUint32(candidate, true) !== 101010256) continue;
    const commentLength = view.getUint16(candidate + 20, true);
    if (candidate + 22 + commentLength === bytes.length) {
      end = candidate;
      break;
    }
  }
  if (end < 0) fail2("INVALID_ZIP", "ZIP \u76EE\u5F55\u4E0D\u5B8C\u6574");
  const diskNumber = view.getUint16(end + 4, true);
  const directoryDisk = view.getUint16(end + 6, true);
  const diskCount = view.getUint16(end + 8, true);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskCount !== count) fail2("UNSUPPORTED_ZIP", "\u4E0D\u652F\u6301\u591A\u78C1\u76D8 ZIP");
  if (count === 65535 || directorySize === 4294967295 || directoryOffset === 4294967295) fail2("UNSUPPORTED_ZIP", "\u4E0D\u652F\u6301 ZIP64");
  if (count > AI_PACKAGE_LIMITS.entryCount) fail2("ENTRY_COUNT_EXCEEDED", `ZIP \u6761\u76EE\u4E0D\u80FD\u8D85\u8FC7 ${AI_PACKAGE_LIMITS.entryCount} \u4E2A`);
  requireRange(directoryOffset, directorySize, end, "ZIP \u4E2D\u592E\u76EE\u5F55\u8D8A\u754C");
  if (directoryOffset + directorySize !== end) fail2("INVALID_ZIP", "ZIP \u4E2D\u592E\u76EE\u5F55\u957F\u5EA6\u4E0D\u4E00\u81F4");
  const entries = [];
  const names = /* @__PURE__ */ new Set();
  let declaredTotal = 0;
  let cursor = directoryOffset;
  const directoryEnd = directoryOffset + directorySize;
  for (let index = 0; index < count; index++) {
    requireRange(cursor, 46, directoryEnd, "ZIP \u4E2D\u592E\u76EE\u5F55\u6761\u76EE\u8D8A\u754C");
    if (view.getUint32(cursor, true) !== 33639248) fail2("INVALID_ZIP", "ZIP \u4E2D\u592E\u76EE\u5F55\u635F\u574F");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const startDisk = view.getUint16(cursor + 34, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    requireRange(cursor, entryLength, directoryEnd, "ZIP \u4E2D\u592E\u76EE\u5F55\u6761\u76EE\u957F\u5EA6\u8D8A\u754C");
    if (startDisk !== 0) fail2("UNSUPPORTED_ZIP", "\u4E0D\u652F\u6301\u8DE8\u78C1\u76D8 ZIP \u6761\u76EE");
    if (compressedSize === 4294967295 || uncompressedSize === 4294967295 || localOffset === 4294967295) fail2("UNSUPPORTED_ZIP", "\u4E0D\u652F\u6301 ZIP64 \u6761\u76EE");
    if ((flags & 1) !== 0 || (flags & 64) !== 0) fail2("ENCRYPTED_ENTRY", "\u4E0D\u652F\u6301\u52A0\u5BC6 ZIP \u6761\u76EE");
    if (method !== 0 && method !== 8) fail2("UNSUPPORTED_COMPRESSION", `\u4E0D\u652F\u6301\u7684 ZIP \u538B\u7F29\u65B9\u5F0F\uFF1A${method}`);
    if (compressedSize > AI_PACKAGE_LIMITS.entryCompressedBytes) fail2("ENTRY_COMPRESSED_TOO_LARGE", "ZIP \u6761\u76EE\u7684\u538B\u7F29\u5927\u5C0F\u8D85\u8FC7\u5B89\u5168\u9650\u5236");
    if (uncompressedSize > AI_PACKAGE_LIMITS.entryUncompressedBytes) fail2("ENTRY_UNCOMPRESSED_TOO_LARGE", "ZIP \u6761\u76EE\u7684\u89E3\u538B\u5927\u5C0F\u8D85\u8FC7\u5B89\u5168\u9650\u5236");
    declaredTotal += uncompressedSize;
    if (declaredTotal > AI_PACKAGE_LIMITS.totalUncompressedBytes) fail2("TOTAL_UNCOMPRESSED_TOO_LARGE", "ZIP \u6761\u76EE\u7684\u603B\u89E3\u538B\u5927\u5C0F\u8D85\u8FC7\u5B89\u5168\u9650\u5236");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeUtf8(pathDecoder, nameBytes, "ZIP \u6761\u76EE\u8DEF\u5F84");
    validatePath(name, nameLength);
    if (names.has(name)) fail2("DUPLICATE_PATH", `ZIP \u5305\u542B\u91CD\u590D\u6761\u76EE\uFF1A${name}`);
    names.add(name);
    entries.push({ name, flags, method, checksum, compressedSize, uncompressedSize, localOffset, directory: name.endsWith("/") });
    cursor += entryLength;
  }
  if (cursor !== directoryEnd) fail2("INVALID_ZIP", "ZIP \u4E2D\u592E\u76EE\u5F55\u6761\u76EE\u6570\u91CF\u6216\u957F\u5EA6\u4E0D\u4E00\u81F4");
  const files = {};
  let actualTotal = 0;
  for (const entry of entries) {
    requireRange(entry.localOffset, 30, directoryOffset, `ZIP \u672C\u5730\u5934\u8D8A\u754C\uFF1A${entry.name}`);
    if (view.getUint32(entry.localOffset, true) !== 67324752) fail2("INVALID_ZIP", `ZIP \u672C\u5730\u5934\u635F\u574F\uFF1A${entry.name}`);
    const localFlags = view.getUint16(entry.localOffset + 6, true);
    const localMethod = view.getUint16(entry.localOffset + 8, true);
    const localChecksum = view.getUint32(entry.localOffset + 14, true);
    const localCompressedSize = view.getUint32(entry.localOffset + 18, true);
    const localUncompressedSize = view.getUint32(entry.localOffset + 22, true);
    const localNameLength = view.getUint16(entry.localOffset + 26, true);
    const localExtraLength = view.getUint16(entry.localOffset + 28, true);
    if ((localFlags & 1) !== 0 || (localFlags & 64) !== 0) fail2("ENCRYPTED_ENTRY", `\u4E0D\u652F\u6301\u52A0\u5BC6 ZIP \u6761\u76EE\uFF1A${entry.name}`);
    if (localFlags !== entry.flags || localMethod !== entry.method) fail2("INVALID_ZIP", `ZIP \u4E2D\u592E\u76EE\u5F55\u4E0E\u672C\u5730\u5934\u4E0D\u4E00\u81F4\uFF1A${entry.name}`);
    if (!localNameLength || localNameLength > AI_PACKAGE_LIMITS.pathBytes) fail2("INVALID_PATH", `ZIP \u672C\u5730\u6761\u76EE\u8DEF\u5F84\u957F\u5EA6\u65E0\u6548\uFF1A${entry.name}`);
    const headerLength = 30 + localNameLength + localExtraLength;
    requireRange(entry.localOffset, headerLength, directoryOffset, `ZIP \u672C\u5730\u5934\u957F\u5EA6\u8D8A\u754C\uFF1A${entry.name}`);
    const localNameStart = entry.localOffset + 30;
    const localName = decodeUtf8(pathDecoder, bytes.subarray(localNameStart, localNameStart + localNameLength), "ZIP \u672C\u5730\u6761\u76EE\u8DEF\u5F84");
    if (localName !== entry.name) fail2("INVALID_ZIP", `ZIP \u4E2D\u592E\u76EE\u5F55\u4E0E\u672C\u5730\u6761\u76EE\u540D\u79F0\u4E0D\u4E00\u81F4\uFF1A${entry.name}`);
    const usesDescriptor = (entry.flags & 8) !== 0;
    if (usesDescriptor) {
      if (localChecksum !== 0 && localChecksum !== entry.checksum || localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize || localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize) fail2("INVALID_ZIP", `ZIP \u6570\u636E\u63CF\u8FF0\u7B26\u58F0\u660E\u4E0D\u4E00\u81F4\uFF1A${entry.name}`);
    } else if (localChecksum !== entry.checksum || localCompressedSize !== entry.compressedSize || localUncompressedSize !== entry.uncompressedSize) {
      fail2("INVALID_ZIP", `ZIP \u4E2D\u592E\u76EE\u5F55\u4E0E\u672C\u5730\u5927\u5C0F\u6216 CRC \u4E0D\u4E00\u81F4\uFF1A${entry.name}`);
    }
    const payloadStart = entry.localOffset + headerLength;
    requireRange(payloadStart, entry.compressedSize, directoryOffset, `ZIP \u6761\u76EE\u6570\u636E\u8D8A\u754C\uFF1A${entry.name}`);
    const payload = bytes.subarray(payloadStart, payloadStart + entry.compressedSize);
    let content;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) fail2("SIZE_MISMATCH", `Stored ZIP \u6761\u76EE\u7684\u538B\u7F29\u4E0E\u89E3\u538B\u5927\u5C0F\u4E0D\u4E00\u81F4\uFF1A${entry.name}`);
      content = payload;
    } else {
      content = await inflateRaw(payload, entry.uncompressedSize, AI_PACKAGE_LIMITS.totalUncompressedBytes - actualTotal);
    }
    if (content.byteLength !== entry.uncompressedSize) fail2("SIZE_MISMATCH", `ZIP \u6761\u76EE\u7684\u5B9E\u9645\u5927\u5C0F\u4E0E\u58F0\u660E\u4E0D\u4E00\u81F4\uFF1A${entry.name}`);
    actualTotal += content.byteLength;
    if (actualTotal > AI_PACKAGE_LIMITS.totalUncompressedBytes) fail2("TOTAL_UNCOMPRESSED_TOO_LARGE", "ZIP \u6761\u76EE\u7684\u5B9E\u9645\u603B\u89E3\u538B\u5927\u5C0F\u8D85\u8FC7\u5B89\u5168\u9650\u5236");
    if (crc32(content) !== entry.checksum) fail2("CRC_MISMATCH", `ZIP \u6761\u76EE\u7684 CRC \u6821\u9A8C\u5931\u8D25\uFF1A${entry.name}`);
    if (entry.directory) {
      if (content.byteLength !== 0) fail2("INVALID_ZIP", `ZIP \u76EE\u5F55\u6761\u76EE\u4E0D\u80FD\u5305\u542B\u6570\u636E\uFF1A${entry.name}`);
      continue;
    }
    if (isMacOsMetadataPath(entry.name)) continue;
    Object.defineProperty(files, entry.name, {
      value: decodeUtf8(contentDecoder, content, `ZIP \u6761\u76EE ${entry.name}`),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  if (!Object.keys(files).length) fail2("INVALID_ZIP", "\u672A\u627E\u5230\u53EF\u89E3\u6790\u7684 .ai \u5305\u5185\u5BB9");
  return files;
}

// ../../runtime/plugins/permissions.ts
var PERMISSION_PATTERN2 = /^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$/;
var PluginPermissionError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginPermissionError";
  }
};
function validatePermissionNames(permissions) {
  if (permissions.length > 64 || new Set(permissions).size !== permissions.length) throw new PluginPermissionError("\u63D2\u4EF6\u6743\u9650\u5FC5\u987B\u552F\u4E00\u4E14\u4E0D\u8D85\u8FC7 64 \u9879");
  for (const permission of permissions) if (!PERMISSION_PATTERN2.test(permission)) throw new PluginPermissionError(`\u63D2\u4EF6\u6743\u9650\u683C\u5F0F\u65E0\u6548\uFF1A${permission}`);
  return [...permissions];
}

// ../../lib/plugin-runtime/signature.ts
var encoder = new TextEncoder();
async function computeBundleIntegrity(bundle) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(bundle)));
  const binary = String.fromCharCode(...digest);
  const value = typeof btoa === "function" ? btoa(binary) : Buffer.from(digest).toString("base64");
  return `sha256-${value}`;
}

// ../../runtime/plugins/package.ts
var ID_PATTERN3 = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var DEFAULT_TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, lib: ["ES2022", "WebWorker"] }, include: ["src/**/*.ts"] }, null, 2);
var PluginPackageError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginPackageError";
  }
};
function jsonObject(text2, path) {
  try {
    const value = JSON.parse(text2);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("\u5FC5\u987B\u662F\u5BF9\u8C61");
    return value;
  } catch (error) {
    throw new PluginPackageError(`${path} \u4E0D\u662F\u6709\u6548 JSON\uFF1A${error instanceof Error ? error.message : "\u89E3\u6790\u5931\u8D25"}`);
  }
}
function validatePlugin(plugin2) {
  if (!ID_PATTERN3.test(plugin2.id)) throw new PluginPackageError("\u63D2\u4EF6 id \u53EA\u80FD\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u548C\u8FDE\u5B57\u7B26");
  if (!plugin2.name.trim() || !plugin2.version.trim()) throw new PluginPackageError("\u63D2\u4EF6\u5FC5\u987B\u5305\u542B name \u548C version");
  if (plugin2.sdkVersion !== "1" || plugin2.language !== "typescript" || plugin2.entry !== "dist/index.js") throw new PluginPackageError("\u63D2\u4EF6\u5FC5\u987B\u4F7F\u7528 Plugin SDK v1\u3001TypeScript \u548C dist/index.js \u5165\u53E3");
  if (!["player", "runtime", "server"].includes(plugin2.runtime) || plugin2.source !== "custom") throw new PluginPackageError("\u63D2\u4EF6 runtime \u6216 source \u65E0\u6548");
  if (plugin2.license && plugin2.license.length > 64) throw new PluginPackageError("\u63D2\u4EF6 license \u8FC7\u957F");
  if (plugin2.homepage && !/^https:\/\//.test(plugin2.homepage)) throw new PluginPackageError("\u63D2\u4EF6 homepage \u5FC5\u987B\u4F7F\u7528 HTTPS");
  validatePermissionNames(plugin2.permissions);
  const tools = plugin2.tools;
  if (!tools.length || tools.length > 32 || new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new PluginPackageError("\u63D2\u4EF6\u5FC5\u987B\u58F0\u660E 1\u201332 \u4E2A\u552F\u4E00 tools");
  for (const tool of tools) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(tool.name) || !tool.description.trim()) throw new PluginPackageError("\u63D2\u4EF6 tool \u540D\u79F0\u6216\u63CF\u8FF0\u65E0\u6548");
    validatePermissionNames(tool.permissions ?? []);
    for (const permission of tool.permissions ?? []) if (!plugin2.permissions.includes(permission)) throw new PluginPackageError(`Tool ${tool.name} \u4F7F\u7528\u4E86\u672A\u58F0\u660E\u6743\u9650 ${permission}`);
  }
  const packageJson = jsonObject(plugin2.packageJson, "package.json");
  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") throw new PluginPackageError("package.json \u5FC5\u987B\u5305\u542B name \u548C version");
  if (packageJson.version !== plugin2.version) throw new PluginPackageError("package.json version \u5FC5\u987B\u4E0E\u63D2\u4EF6 manifest \u4E00\u81F4");
  jsonObject(plugin2.tsconfigJson, "tsconfig.json");
  if (!plugin2.sourceCode.trim()) throw new PluginPackageError("src/index.ts \u4E0D\u80FD\u4E3A\u7A7A");
  if (!plugin2.bundleCode.trim()) throw new PluginPackageError("dist/index.js \u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u6784\u5EFA\u63D2\u4EF6");
  if (new TextEncoder().encode(plugin2.bundleCode).length > 4 * 1024 * 1024) throw new PluginPackageError("dist/index.js \u4E0D\u80FD\u8D85\u8FC7 4 MiB");
  if (/\bimport\s*(?:\(|\{|\*|[A-Za-z_$])/.test(plugin2.bundleCode)) throw new PluginPackageError("dist/index.js \u5FC5\u987B\u662F\u5355\u6587\u4EF6 bundle\uFF0C\u4E0D\u80FD\u4FDD\u7559 import");
  if (plugin2.limits?.timeoutMs !== void 0 && (!Number.isInteger(plugin2.limits.timeoutMs) || plugin2.limits.timeoutMs < 100 || plugin2.limits.timeoutMs > 12e4)) throw new PluginPackageError("\u63D2\u4EF6 timeoutMs \u5FC5\u987B\u662F 100\u2013120000 \u7684\u6574\u6570");
  if (plugin2.limits?.maxOutputBytes !== void 0 && (!Number.isInteger(plugin2.limits.maxOutputBytes) || plugin2.limits.maxOutputBytes < 1024 || plugin2.limits.maxOutputBytes > 1048576)) throw new PluginPackageError("\u63D2\u4EF6 maxOutputBytes \u5FC5\u987B\u662F 1024\u20131048576 \u7684\u6574\u6570");
  if (plugin2.limits?.maxConcurrency !== void 0 && (!Number.isInteger(plugin2.limits.maxConcurrency) || plugin2.limits.maxConcurrency < 1 || plugin2.limits.maxConcurrency > 16)) throw new PluginPackageError("\u63D2\u4EF6 maxConcurrency \u5FC5\u987B\u662F 1\u201316 \u7684\u6574\u6570");
  return plugin2;
}
function pluginPackageFiles(plugin2) {
  validatePlugin(plugin2);
  return {
    "agent-plugin.json": JSON.stringify({
      id: plugin2.id,
      name: plugin2.name,
      description: plugin2.description,
      version: plugin2.version,
      sdkVersion: plugin2.sdkVersion,
      language: plugin2.language,
      entry: plugin2.entry,
      runtime: plugin2.runtime,
      source: plugin2.source,
      author: plugin2.author,
      license: plugin2.license,
      homepage: plugin2.homepage,
      permissions: plugin2.permissions,
      tools: plugin2.tools,
      limits: plugin2.limits,
      integrity: plugin2.integrity,
      signature: plugin2.signature
    }, null, 2),
    "package.json": plugin2.packageJson,
    "tsconfig.json": plugin2.tsconfigJson,
    "src/index.ts": plugin2.sourceCode,
    "dist/index.js": plugin2.bundleCode,
    "README.md": plugin2.readme
  };
}
async function finalizePlugin(plugin2) {
  return validatePlugin({ ...plugin2, integrity: await computeBundleIntegrity(plugin2.bundleCode) });
}
function createPluginScaffold(id = "my_plugin", name = "My Plugin") {
  return {
    id,
    name,
    description: "\u4F7F\u7528 AgComm Plugin SDK \u5F00\u53D1\u7684 TypeScript \u63D2\u4EF6",
    version: "1.0.0",
    sdkVersion: "1",
    language: "typescript",
    entry: "dist/index.js",
    runtime: "player",
    source: "custom",
    license: "MIT",
    permissions: [],
    tools: [{ name: "run", description: "\u6267\u884C\u63D2\u4EF6\u7684\u9ED8\u8BA4\u64CD\u4F5C", permissions: [] }],
    packageJson: JSON.stringify({
      name: id.replace(/_/g, "-"),
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { build: "tsup src/index.ts --format esm --platform browser --no-splitting --out-dir dist" },
      dependencies: { "@agcomm/plugin-sdk": "^1.0.0" },
      devDependencies: { tsup: "^8.0.0", typescript: "^5.0.0" }
    }, null, 2),
    tsconfigJson: DEFAULT_TSCONFIG,
    sourceCode: `import { definePlugin, defineTool } from "@agcomm/plugin-sdk";

export default definePlugin({
  tools: {
    run: defineTool({
      async run(input, context) {
        context.checkAborted();
        context.log("info", "plugin started");
        return { input };
      },
    }),
  },
});
`,
    bundleCode: `export default { tools: { run: { async run(input, context) { context.checkAborted(); context.log("info", "plugin started"); return { input }; } } } };
`,
    readme: `# ${name}

TypeScript plugin for AgComm.

## Build

\`npm install\` then \`npm run build\`. Dependencies are bundled into \`dist/index.js\`.
`
  };
}

// ../../domain/flow/validator.ts
function validateEditorFlow(project) {
  const result = validateFlow(compileFlow(project));
  const issues = [...result.issues];
  const skillIds = new Set(project.skills.map((skill) => skill.id));
  const pluginIds = new Set(project.plugins.map((plugin2) => plugin2.id));
  for (const node2 of project.nodes) {
    if (node2.type === "INPUT") {
      const form = readInputForm(node2, project.variables);
      if (!form.fields.length) issues.push({ code: "INVALID_NODE", severity: "error", nodeId: node2.id, message: `\u7528\u6237\u8F93\u5165\u8282\u70B9\u201C${node2.title}\u201D\u81F3\u5C11\u9700\u8981\u914D\u7F6E\u4E00\u4E2A\u53D8\u91CF\u7EC4\u4EF6` });
      const seen = /* @__PURE__ */ new Set();
      for (const field of form.fields) {
        if (seen.has(field.variable)) issues.push({ code: "INVALID_NODE", severity: "error", nodeId: node2.id, message: `\u7528\u6237\u8F93\u5165\u8282\u70B9\u201C${node2.title}\u201D\u91CD\u590D\u914D\u7F6E\u4E86\u53D8\u91CF\u201C${field.variable}\u201D` });
        seen.add(field.variable);
      }
    }
    const skillId = node2.type === "SKILL" ? String(node2.config?.skillId ?? "") : void 0;
    if (skillId && !skillIds.has(skillId)) issues.push({ code: "INVALID_NODE", severity: "error", nodeId: node2.id, message: `\u8282\u70B9\u201C${node2.title}\u201D\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684 Skill\u201C${skillId}\u201D` });
    if (node2.type === "WORKSPACE" && node2.workspace) {
      if (!skillIds.has(node2.workspace.agentSkillId)) issues.push({ code: "INVALID_NODE", severity: "error", nodeId: node2.id, message: `Workspace\u201C${node2.title}\u201D\u7684\u603B Agent Skill \u4E0D\u5B58\u5728` });
      for (const id of node2.workspace.skillIds) if (!skillIds.has(id)) issues.push({ code: "INVALID_NODE", severity: "error", nodeId: node2.id, message: `Workspace\u201C${node2.title}\u201D\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684 Skill\u201C${id}\u201D` });
      if (node2.workspace.skillIds.includes(node2.workspace.agentSkillId)) issues.push({ code: "INVALID_NODE", severity: "error", nodeId: node2.id, message: `Workspace\u201C${node2.title}\u201D\u4E0D\u80FD\u628A\u603B Agent Skill \u540C\u65F6\u8BBE\u4E3A\u53EF\u8C03\u7528 Skill` });
    }
  }
  const outputVariables = /* @__PURE__ */ new Map();
  for (const node2 of project.nodes) if (node2.outputVar) {
    const previous = outputVariables.get(node2.outputVar);
    if (previous) issues.push({ code: "INVALID_NODE", severity: "warning", nodeId: node2.id, message: `\u8F93\u51FA\u53D8\u91CF\u201C${node2.outputVar}\u201D\u540C\u65F6\u7531\u8282\u70B9\u201C${previous}\u201D\u548C\u201C${node2.title}\u201D\u5199\u5165` });
    else outputVariables.set(node2.outputVar, node2.title);
  }
  for (const skill of project.skills) for (const pluginId of skill.pluginIds) {
    if (!pluginIds.has(pluginId)) issues.push({ code: "INVALID_NODE", severity: "error", message: `Skill\u201C${skill.name}\u201D\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684 Plugin\u201C${pluginId}\u201D` });
  }
  for (const plugin2 of project.plugins) {
    try {
      validatePlugin(plugin2);
    } catch (error) {
      issues.push({ code: "INVALID_NODE", severity: "error", message: `Plugin\u201C${plugin2.name || plugin2.id}\u201D\u65E0\u6548\uFF1A${error instanceof Error ? error.message : "\u6821\u9A8C\u5931\u8D25"}` });
    }
  }
  return { ...result, valid: !issues.some((issue) => issue.severity === "error"), issues };
}

// ../../domain/package/generated/validators.js
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports, module) {
    "use strict";
    module.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports.default = equal;
  }
});
var manifestV1 = validate10;
var schema11 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v1/manifest.schema.json", "title": "AgComm .ai manifest v2", "type": "object", "required": ["format", "id", "name", "version"], "properties": { "formatVersion": { "const": 1 }, "format": { "const": "ai_package" }, "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "created_at": { "type": "string", "maxLength": 64 }, "updated_at": { "type": "string", "maxLength": 64 }, "author": { "type": "object", "properties": { "name": { "type": "string", "maxLength": 120 } }, "additionalProperties": false }, "files": { "type": "array", "maxItems": 512, "items": { "type": "string", "maxLength": 240 } }, "signature": { "type": ["object", "null"] } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
var func2 = Object.prototype.hasOwnProperty;
var func3 = require_ucs2length().default;
var pattern0 = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$", "u");
function validate10(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.format === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "format" }, message: "must have required property 'format'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema11.properties, key0)) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.formatVersion !== void 0) {
      if (1 !== data.formatVersion) {
        const err5 = { instancePath: instancePath + "/formatVersion", schemaPath: "#/properties/formatVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.format !== void 0) {
      if ("ai_package" !== data.format) {
        const err6 = { instancePath: instancePath + "/format", schemaPath: "#/properties/format/const", keyword: "const", params: { allowedValue: "ai_package" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern0.test(data2)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func3(data3) > 120) {
          const err9 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data4 = data.version;
      if (typeof data4 === "string") {
        if (func3(data4) > 32) {
          const err12 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (func3(data4) < 1) {
          const err13 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.created_at !== void 0) {
      let data5 = data.created_at;
      if (typeof data5 === "string") {
        if (func3(data5) > 64) {
          const err15 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.updated_at !== void 0) {
      let data6 = data.updated_at;
      if (typeof data6 === "string") {
        if (func3(data6) > 64) {
          const err17 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      } else {
        const err18 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data7 = data.author;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        for (const key1 in data7) {
          if (!(key1 === "name")) {
            const err19 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
        }
        if (data7.name !== void 0) {
          let data8 = data7.name;
          if (typeof data8 === "string") {
            if (func3(data8) > 120) {
              const err20 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
          } else {
            const err21 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err21];
            } else {
              vErrors.push(err21);
            }
            errors++;
          }
        }
      } else {
        const err22 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.files !== void 0) {
      let data9 = data.files;
      if (Array.isArray(data9)) {
        if (data9.length > 512) {
          const err23 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/maxItems", keyword: "maxItems", params: { limit: 512 }, message: "must NOT have more than 512 items" };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
        const len0 = data9.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data10 = data9[i0];
          if (typeof data10 === "string") {
            if (func3(data10) > 240) {
              const err24 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/maxLength", keyword: "maxLength", params: { limit: 240 }, message: "must NOT have more than 240 characters" };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
          } else {
            const err25 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
      } else {
        const err26 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data11 = data.signature;
      if (!(data11 && typeof data11 == "object" && !Array.isArray(data11)) && data11 !== null) {
        const err27 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: schema11.properties.signature.type }, message: "must be object,null" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
  } else {
    const err28 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err28];
    } else {
      vErrors.push(err28);
    }
    errors++;
  }
  validate10.errors = vErrors;
  return errors === 0;
}
var manifestV2 = validate11;
var schema13 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v2/manifest.schema.json", "title": "AgComm .ai manifest v2", "type": "object", "required": ["formatVersion", "format", "id", "name", "version"], "properties": { "formatVersion": { "const": 2 }, "format": { "const": "ai_package" }, "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "created_at": { "type": "string", "maxLength": 64 }, "updated_at": { "type": "string", "maxLength": 64 }, "author": { "type": "object", "properties": { "name": { "type": "string", "maxLength": 120 } }, "additionalProperties": false }, "files": { "type": "array", "maxItems": 512, "items": { "type": "string", "maxLength": 240 } }, "signature": { "type": ["object", "null"] } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
function validate11(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.formatVersion === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "formatVersion" }, message: "must have required property 'formatVersion'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.format === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "format" }, message: "must have required property 'format'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema13.properties, key0)) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.formatVersion !== void 0) {
      if (2 !== data.formatVersion) {
        const err6 = { instancePath: instancePath + "/formatVersion", schemaPath: "#/properties/formatVersion/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.format !== void 0) {
      if ("ai_package" !== data.format) {
        const err7 = { instancePath: instancePath + "/format", schemaPath: "#/properties/format/const", keyword: "const", params: { allowedValue: "ai_package" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern0.test(data2)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func3(data3) > 120) {
          const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data4 = data.version;
      if (typeof data4 === "string") {
        if (func3(data4) > 32) {
          const err13 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (func3(data4) < 1) {
          const err14 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.created_at !== void 0) {
      let data5 = data.created_at;
      if (typeof data5 === "string") {
        if (func3(data5) > 64) {
          const err16 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.updated_at !== void 0) {
      let data6 = data.updated_at;
      if (typeof data6 === "string") {
        if (func3(data6) > 64) {
          const err18 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data7 = data.author;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        for (const key1 in data7) {
          if (!(key1 === "name")) {
            const err20 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
        }
        if (data7.name !== void 0) {
          let data8 = data7.name;
          if (typeof data8 === "string") {
            if (func3(data8) > 120) {
              const err21 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          } else {
            const err22 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
      } else {
        const err23 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.files !== void 0) {
      let data9 = data.files;
      if (Array.isArray(data9)) {
        if (data9.length > 512) {
          const err24 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/maxItems", keyword: "maxItems", params: { limit: 512 }, message: "must NOT have more than 512 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len0 = data9.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data10 = data9[i0];
          if (typeof data10 === "string") {
            if (func3(data10) > 240) {
              const err25 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/maxLength", keyword: "maxLength", params: { limit: 240 }, message: "must NOT have more than 240 characters" };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
          } else {
            const err26 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data11 = data.signature;
      if (!(data11 && typeof data11 == "object" && !Array.isArray(data11)) && data11 !== null) {
        const err28 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: schema13.properties.signature.type }, message: "must be object,null" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
  } else {
    const err29 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err29];
    } else {
      vErrors.push(err29);
    }
    errors++;
  }
  validate11.errors = vErrors;
  return errors === 0;
}
var manifestV5 = validate14;
var schema19 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v5/manifest.schema.json", "title": "AgComm .ai manifest v5", "type": "object", "required": ["formatVersion", "format", "id", "name", "version"], "properties": { "formatVersion": { "const": 5 }, "format": { "const": "ai_package" }, "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "created_at": { "type": "string", "maxLength": 64 }, "updated_at": { "type": "string", "maxLength": 64 }, "author": { "type": "object", "properties": { "name": { "type": "string", "maxLength": 120 } }, "additionalProperties": false }, "files": { "type": "array", "maxItems": 512, "items": { "type": "string", "maxLength": 240 } }, "signature": { "type": ["object", "null"] } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
function validate14(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.formatVersion === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "formatVersion" }, message: "must have required property 'formatVersion'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.format === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "format" }, message: "must have required property 'format'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema19.properties, key0)) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.formatVersion !== void 0) {
      if (5 !== data.formatVersion) {
        const err6 = { instancePath: instancePath + "/formatVersion", schemaPath: "#/properties/formatVersion/const", keyword: "const", params: { allowedValue: 5 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.format !== void 0) {
      if ("ai_package" !== data.format) {
        const err7 = { instancePath: instancePath + "/format", schemaPath: "#/properties/format/const", keyword: "const", params: { allowedValue: "ai_package" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern0.test(data2)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func3(data3) > 120) {
          const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data4 = data.version;
      if (typeof data4 === "string") {
        if (func3(data4) > 32) {
          const err13 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (func3(data4) < 1) {
          const err14 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.created_at !== void 0) {
      let data5 = data.created_at;
      if (typeof data5 === "string") {
        if (func3(data5) > 64) {
          const err16 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.updated_at !== void 0) {
      let data6 = data.updated_at;
      if (typeof data6 === "string") {
        if (func3(data6) > 64) {
          const err18 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data7 = data.author;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        for (const key1 in data7) {
          if (!(key1 === "name")) {
            const err20 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
        }
        if (data7.name !== void 0) {
          let data8 = data7.name;
          if (typeof data8 === "string") {
            if (func3(data8) > 120) {
              const err21 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          } else {
            const err22 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
      } else {
        const err23 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.files !== void 0) {
      let data9 = data.files;
      if (Array.isArray(data9)) {
        if (data9.length > 512) {
          const err24 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/maxItems", keyword: "maxItems", params: { limit: 512 }, message: "must NOT have more than 512 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len0 = data9.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data10 = data9[i0];
          if (typeof data10 === "string") {
            if (func3(data10) > 240) {
              const err25 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/maxLength", keyword: "maxLength", params: { limit: 240 }, message: "must NOT have more than 240 characters" };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
          } else {
            const err26 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data11 = data.signature;
      if (!(data11 && typeof data11 == "object" && !Array.isArray(data11)) && data11 !== null) {
        const err28 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: schema19.properties.signature.type }, message: "must be object,null" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
  } else {
    const err29 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err29];
    } else {
      vErrors.push(err29);
    }
    errors++;
  }
  validate14.errors = vErrors;
  return errors === 0;
}
var manifestV6 = validate15;
var schema21 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v6/manifest.schema.json", "title": "AgComm .ai manifest v6", "type": "object", "required": ["formatVersion", "format", "id", "name", "version"], "properties": { "formatVersion": { "const": 6 }, "format": { "const": "ai_package" }, "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "created_at": { "type": "string", "maxLength": 64 }, "updated_at": { "type": "string", "maxLength": 64 }, "author": { "type": "object", "properties": { "name": { "type": "string", "maxLength": 120 } }, "additionalProperties": false }, "files": { "type": "array", "maxItems": 512, "items": { "type": "string", "maxLength": 240 } }, "signature": { "type": ["object", "null"] } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
function validate15(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.formatVersion === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "formatVersion" }, message: "must have required property 'formatVersion'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.format === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "format" }, message: "must have required property 'format'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema21.properties, key0)) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.formatVersion !== void 0) {
      if (6 !== data.formatVersion) {
        const err6 = { instancePath: instancePath + "/formatVersion", schemaPath: "#/properties/formatVersion/const", keyword: "const", params: { allowedValue: 6 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.format !== void 0) {
      if ("ai_package" !== data.format) {
        const err7 = { instancePath: instancePath + "/format", schemaPath: "#/properties/format/const", keyword: "const", params: { allowedValue: "ai_package" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern0.test(data2)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func3(data3) > 120) {
          const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data4 = data.version;
      if (typeof data4 === "string") {
        if (func3(data4) > 32) {
          const err13 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (func3(data4) < 1) {
          const err14 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.created_at !== void 0) {
      let data5 = data.created_at;
      if (typeof data5 === "string") {
        if (func3(data5) > 64) {
          const err16 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.updated_at !== void 0) {
      let data6 = data.updated_at;
      if (typeof data6 === "string") {
        if (func3(data6) > 64) {
          const err18 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data7 = data.author;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        for (const key1 in data7) {
          if (!(key1 === "name")) {
            const err20 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
        }
        if (data7.name !== void 0) {
          let data8 = data7.name;
          if (typeof data8 === "string") {
            if (func3(data8) > 120) {
              const err21 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          } else {
            const err22 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
      } else {
        const err23 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.files !== void 0) {
      let data9 = data.files;
      if (Array.isArray(data9)) {
        if (data9.length > 512) {
          const err24 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/maxItems", keyword: "maxItems", params: { limit: 512 }, message: "must NOT have more than 512 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len0 = data9.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data10 = data9[i0];
          if (typeof data10 === "string") {
            if (func3(data10) > 240) {
              const err25 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/maxLength", keyword: "maxLength", params: { limit: 240 }, message: "must NOT have more than 240 characters" };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
          } else {
            const err26 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data11 = data.signature;
      if (!(data11 && typeof data11 == "object" && !Array.isArray(data11)) && data11 !== null) {
        const err28 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: schema21.properties.signature.type }, message: "must be object,null" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
  } else {
    const err29 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err29];
    } else {
      vErrors.push(err29);
    }
    errors++;
  }
  validate15.errors = vErrors;
  return errors === 0;
}
var manifestV7 = validate16;
var schema23 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v7/manifest.schema.json", "title": "AgComm .ai manifest v7", "type": "object", "required": ["formatVersion", "format", "id", "name", "version"], "properties": { "formatVersion": { "const": 7 }, "format": { "const": "ai_package" }, "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "created_at": { "type": "string", "maxLength": 64 }, "updated_at": { "type": "string", "maxLength": 64 }, "author": { "type": "object", "properties": { "name": { "type": "string", "maxLength": 120 } }, "additionalProperties": false }, "files": { "type": "array", "maxItems": 512, "items": { "type": "string", "maxLength": 240 } }, "signature": { "type": ["object", "null"] } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
function validate16(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.formatVersion === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "formatVersion" }, message: "must have required property 'formatVersion'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.format === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "format" }, message: "must have required property 'format'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema23.properties, key0)) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.formatVersion !== void 0) {
      if (7 !== data.formatVersion) {
        const err6 = { instancePath: instancePath + "/formatVersion", schemaPath: "#/properties/formatVersion/const", keyword: "const", params: { allowedValue: 7 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.format !== void 0) {
      if ("ai_package" !== data.format) {
        const err7 = { instancePath: instancePath + "/format", schemaPath: "#/properties/format/const", keyword: "const", params: { allowedValue: "ai_package" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern0.test(data2)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func3(data3) > 120) {
          const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data4 = data.version;
      if (typeof data4 === "string") {
        if (func3(data4) > 32) {
          const err13 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (func3(data4) < 1) {
          const err14 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.created_at !== void 0) {
      let data5 = data.created_at;
      if (typeof data5 === "string") {
        if (func3(data5) > 64) {
          const err16 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.updated_at !== void 0) {
      let data6 = data.updated_at;
      if (typeof data6 === "string") {
        if (func3(data6) > 64) {
          const err18 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data7 = data.author;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        for (const key1 in data7) {
          if (!(key1 === "name")) {
            const err20 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
        }
        if (data7.name !== void 0) {
          let data8 = data7.name;
          if (typeof data8 === "string") {
            if (func3(data8) > 120) {
              const err21 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          } else {
            const err22 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
      } else {
        const err23 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.files !== void 0) {
      let data9 = data.files;
      if (Array.isArray(data9)) {
        if (data9.length > 512) {
          const err24 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/maxItems", keyword: "maxItems", params: { limit: 512 }, message: "must NOT have more than 512 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len0 = data9.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data10 = data9[i0];
          if (typeof data10 === "string") {
            if (func3(data10) > 240) {
              const err25 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/maxLength", keyword: "maxLength", params: { limit: 240 }, message: "must NOT have more than 240 characters" };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
          } else {
            const err26 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data11 = data.signature;
      if (!(data11 && typeof data11 == "object" && !Array.isArray(data11)) && data11 !== null) {
        const err28 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: schema23.properties.signature.type }, message: "must be object,null" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
  } else {
    const err29 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err29];
    } else {
      vErrors.push(err29);
    }
    errors++;
  }
  validate16.errors = vErrors;
  return errors === 0;
}
var manifestBeta1 = validate17;
var schema25 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/beta-one/manifest.schema.json", "title": "AgComm .ai manifest Beta 1", "type": "object", "required": ["formatVersion", "format", "id", "name", "version"], "properties": { "formatVersion": { "const": 8 }, "format": { "const": "ai_package" }, "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "created_at": { "type": "string", "maxLength": 64 }, "updated_at": { "type": "string", "maxLength": 64 }, "author": { "type": "object", "properties": { "name": { "type": "string", "maxLength": 120 } }, "additionalProperties": false }, "files": { "type": "array", "maxItems": 512, "items": { "type": "string", "maxLength": 240 } }, "signature": { "type": ["object", "null"] } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
function validate17(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.formatVersion === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "formatVersion" }, message: "must have required property 'formatVersion'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.format === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "format" }, message: "must have required property 'format'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema25.properties, key0)) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.formatVersion !== void 0) {
      if (8 !== data.formatVersion) {
        const err6 = { instancePath: instancePath + "/formatVersion", schemaPath: "#/properties/formatVersion/const", keyword: "const", params: { allowedValue: 8 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.format !== void 0) {
      if ("ai_package" !== data.format) {
        const err7 = { instancePath: instancePath + "/format", schemaPath: "#/properties/format/const", keyword: "const", params: { allowedValue: "ai_package" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern0.test(data2)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func3(data3) > 120) {
          const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data4 = data.version;
      if (typeof data4 === "string") {
        if (func3(data4) > 32) {
          const err13 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (func3(data4) < 1) {
          const err14 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.created_at !== void 0) {
      let data5 = data.created_at;
      if (typeof data5 === "string") {
        if (func3(data5) > 64) {
          const err16 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/created_at", schemaPath: "#/properties/created_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.updated_at !== void 0) {
      let data6 = data.updated_at;
      if (typeof data6 === "string") {
        if (func3(data6) > 64) {
          const err18 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/updated_at", schemaPath: "#/properties/updated_at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data7 = data.author;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        for (const key1 in data7) {
          if (!(key1 === "name")) {
            const err20 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
        }
        if (data7.name !== void 0) {
          let data8 = data7.name;
          if (typeof data8 === "string") {
            if (func3(data8) > 120) {
              const err21 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          } else {
            const err22 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
      } else {
        const err23 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.files !== void 0) {
      let data9 = data.files;
      if (Array.isArray(data9)) {
        if (data9.length > 512) {
          const err24 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/maxItems", keyword: "maxItems", params: { limit: 512 }, message: "must NOT have more than 512 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len0 = data9.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data10 = data9[i0];
          if (typeof data10 === "string") {
            if (func3(data10) > 240) {
              const err25 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/maxLength", keyword: "maxLength", params: { limit: 240 }, message: "must NOT have more than 240 characters" };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
          } else {
            const err26 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data11 = data.signature;
      if (!(data11 && typeof data11 == "object" && !Array.isArray(data11)) && data11 !== null) {
        const err28 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: schema25.properties.signature.type }, message: "must be object,null" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
  } else {
    const err29 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err29];
    } else {
      vErrors.push(err29);
    }
    errors++;
  }
  validate17.errors = vErrors;
  return errors === 0;
}
var flow = validate18;
var schema27 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v2/flow.schema.json", "title": "AgComm .ai flow v2", "type": "object", "required": ["entry", "nodes", "edges"], "properties": { "entry": { "$ref": "#/definitions/id" }, "nodes": { "type": "array", "minItems": 1, "maxItems": 2e3, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } }, "edges": { "type": "array", "maxItems": 8e3, "items": { "type": "object", "required": ["from", "to"], "properties": { "id": { "$ref": "#/definitions/id" }, "from": { "$ref": "#/definitions/id" }, "to": { "$ref": "#/definitions/id" }, "label": { "type": "string", "maxLength": 200 }, "condition": { "type": "string", "maxLength": 2e3 } }, "additionalProperties": false } }, "variables": { "type": "object", "maxProperties": 512 }, "visualizations": { "type": "array", "maxItems": 32, "uniqueItems": true, "items": { "type": "string", "maxLength": 64 } }, "config": { "type": "object", "properties": { "timeoutMs": { "type": "integer", "minimum": 1, "maximum": 6e5 }, "maxConcurrency": { "type": "integer", "minimum": 1, "maximum": 32 }, "onError": { "enum": ["stop", "continue"] }, "interaction": { "type": "object", "properties": { "conversation": { "type": "object", "properties": { "multiTurn": { "type": "boolean" }, "history": { "type": "boolean" }, "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 } }, "additionalProperties": false }, "knowledge": { "type": "object", "required": ["enabled"], "properties": { "enabled": { "const": true }, "scopes": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["app", "session"] } }, "topK": { "type": "integer", "minimum": 1, "maximum": 20 }, "chunkSize": { "type": "integer", "minimum": 200, "maximum": 8e3 }, "chunkOverlap": { "type": "integer", "minimum": 0, "maximum": 2e3 } }, "additionalProperties": false } }, "additionalProperties": false } }, "additionalProperties": true } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
var func0 = require_equal().default;
function validate18(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.entry === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.nodes === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "nodes" }, message: "must have required property 'nodes'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.edges === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edges" }, message: "must have required property 'edges'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "entry" || key0 === "nodes" || key0 === "edges" || key0 === "variables" || key0 === "visualizations" || key0 === "config")) {
        const err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.entry !== void 0) {
      let data0 = data.entry;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err4 = { instancePath: instancePath + "/entry", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/entry", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.nodes !== void 0) {
      let data1 = data.nodes;
      if (Array.isArray(data1)) {
        if (data1.length > 2e3) {
          const err6 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/maxItems", keyword: "maxItems", params: { limit: 2e3 }, message: "must NOT have more than 2000 items" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data1.length < 1) {
          const err7 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (typeof data2 === "string") {
            if (!pattern0.test(data2)) {
              const err8 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        let i1 = data1.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data1[i1], data1[j0])) {
                const err10 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err11 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.edges !== void 0) {
      let data3 = data.edges;
      if (Array.isArray(data3)) {
        if (data3.length > 8e3) {
          const err12 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/maxItems", keyword: "maxItems", params: { limit: 8e3 }, message: "must NOT have more than 8000 items" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        const len1 = data3.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data4 = data3[i2];
          if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
            if (data4.from === void 0) {
              const err13 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
            if (data4.to === void 0) {
              const err14 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
            for (const key1 in data4) {
              if (!(key1 === "id" || key1 === "from" || key1 === "to" || key1 === "label" || key1 === "condition")) {
                const err15 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
            }
            if (data4.id !== void 0) {
              let data5 = data4.id;
              if (typeof data5 === "string") {
                if (!pattern0.test(data5)) {
                  const err16 = { instancePath: instancePath + "/edges/" + i2 + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err16];
                  } else {
                    vErrors.push(err16);
                  }
                  errors++;
                }
              } else {
                const err17 = { instancePath: instancePath + "/edges/" + i2 + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
            if (data4.from !== void 0) {
              let data6 = data4.from;
              if (typeof data6 === "string") {
                if (!pattern0.test(data6)) {
                  const err18 = { instancePath: instancePath + "/edges/" + i2 + "/from", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err18];
                  } else {
                    vErrors.push(err18);
                  }
                  errors++;
                }
              } else {
                const err19 = { instancePath: instancePath + "/edges/" + i2 + "/from", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err19];
                } else {
                  vErrors.push(err19);
                }
                errors++;
              }
            }
            if (data4.to !== void 0) {
              let data7 = data4.to;
              if (typeof data7 === "string") {
                if (!pattern0.test(data7)) {
                  const err20 = { instancePath: instancePath + "/edges/" + i2 + "/to", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
              } else {
                const err21 = { instancePath: instancePath + "/edges/" + i2 + "/to", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
            if (data4.label !== void 0) {
              let data8 = data4.label;
              if (typeof data8 === "string") {
                if (func3(data8) > 200) {
                  const err22 = { instancePath: instancePath + "/edges/" + i2 + "/label", schemaPath: "#/properties/edges/items/properties/label/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
                  if (vErrors === null) {
                    vErrors = [err22];
                  } else {
                    vErrors.push(err22);
                  }
                  errors++;
                }
              } else {
                const err23 = { instancePath: instancePath + "/edges/" + i2 + "/label", schemaPath: "#/properties/edges/items/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
            }
            if (data4.condition !== void 0) {
              let data9 = data4.condition;
              if (typeof data9 === "string") {
                if (func3(data9) > 2e3) {
                  const err24 = { instancePath: instancePath + "/edges/" + i2 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
                  if (vErrors === null) {
                    vErrors = [err24];
                  } else {
                    vErrors.push(err24);
                  }
                  errors++;
                }
              } else {
                const err25 = { instancePath: instancePath + "/edges/" + i2 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
          } else {
            const err26 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      let data10 = data.variables;
      if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
        if (Object.keys(data10).length > 512) {
          const err28 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/maxProperties", keyword: "maxProperties", params: { limit: 512 }, message: "must NOT have more than 512 properties" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
      } else {
        const err29 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.visualizations !== void 0) {
      let data11 = data.visualizations;
      if (Array.isArray(data11)) {
        if (data11.length > 32) {
          const err30 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        const len2 = data11.length;
        for (let i3 = 0; i3 < len2; i3++) {
          let data12 = data11[i3];
          if (typeof data12 === "string") {
            if (func3(data12) > 64) {
              const err31 = { instancePath: instancePath + "/visualizations/" + i3, schemaPath: "#/properties/visualizations/items/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
          } else {
            const err32 = { instancePath: instancePath + "/visualizations/" + i3, schemaPath: "#/properties/visualizations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        let i4 = data11.length;
        let j1;
        if (i4 > 1) {
          const indices0 = {};
          for (; i4--; ) {
            let item0 = data11[i4];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j1 = indices0[item0];
              const err33 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i4 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
              break;
            }
            indices0[item0] = i4;
          }
        }
      } else {
        const err34 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
    if (data.config !== void 0) {
      let data13 = data.config;
      if (data13 && typeof data13 == "object" && !Array.isArray(data13)) {
        if (data13.timeoutMs !== void 0) {
          let data14 = data13.timeoutMs;
          if (!(typeof data14 == "number" && (!(data14 % 1) && !isNaN(data14)) && isFinite(data14))) {
            const err35 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
          if (typeof data14 == "number" && isFinite(data14)) {
            if (data14 > 6e5 || isNaN(data14)) {
              const err36 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e5 }, message: "must be <= 600000" };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
            if (data14 < 1 || isNaN(data14)) {
              const err37 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err37];
              } else {
                vErrors.push(err37);
              }
              errors++;
            }
          }
        }
        if (data13.maxConcurrency !== void 0) {
          let data15 = data13.maxConcurrency;
          if (!(typeof data15 == "number" && (!(data15 % 1) && !isNaN(data15)) && isFinite(data15))) {
            const err38 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err38];
            } else {
              vErrors.push(err38);
            }
            errors++;
          }
          if (typeof data15 == "number" && isFinite(data15)) {
            if (data15 > 32 || isNaN(data15)) {
              const err39 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/maximum", keyword: "maximum", params: { comparison: "<=", limit: 32 }, message: "must be <= 32" };
              if (vErrors === null) {
                vErrors = [err39];
              } else {
                vErrors.push(err39);
              }
              errors++;
            }
            if (data15 < 1 || isNaN(data15)) {
              const err40 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err40];
              } else {
                vErrors.push(err40);
              }
              errors++;
            }
          }
        }
        if (data13.onError !== void 0) {
          let data16 = data13.onError;
          if (!(data16 === "stop" || data16 === "continue")) {
            const err41 = { instancePath: instancePath + "/config/onError", schemaPath: "#/properties/config/properties/onError/enum", keyword: "enum", params: { allowedValues: schema27.properties.config.properties.onError.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err41];
            } else {
              vErrors.push(err41);
            }
            errors++;
          }
        }
        if (data13.interaction !== void 0) {
          let data17 = data13.interaction;
          if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
            for (const key2 in data17) {
              if (!(key2 === "conversation" || key2 === "knowledge")) {
                const err42 = { instancePath: instancePath + "/config/interaction", schemaPath: "#/properties/config/properties/interaction/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err42];
                } else {
                  vErrors.push(err42);
                }
                errors++;
              }
            }
            if (data17.conversation !== void 0) {
              let data18 = data17.conversation;
              if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
                for (const key3 in data18) {
                  if (!(key3 === "multiTurn" || key3 === "history" || key3 === "historyWindow")) {
                    const err43 = { instancePath: instancePath + "/config/interaction/conversation", schemaPath: "#/properties/config/properties/interaction/properties/conversation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err43];
                    } else {
                      vErrors.push(err43);
                    }
                    errors++;
                  }
                }
                if (data18.multiTurn !== void 0) {
                  if (typeof data18.multiTurn !== "boolean") {
                    const err44 = { instancePath: instancePath + "/config/interaction/conversation/multiTurn", schemaPath: "#/properties/config/properties/interaction/properties/conversation/properties/multiTurn/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                    if (vErrors === null) {
                      vErrors = [err44];
                    } else {
                      vErrors.push(err44);
                    }
                    errors++;
                  }
                }
                if (data18.history !== void 0) {
                  if (typeof data18.history !== "boolean") {
                    const err45 = { instancePath: instancePath + "/config/interaction/conversation/history", schemaPath: "#/properties/config/properties/interaction/properties/conversation/properties/history/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                    if (vErrors === null) {
                      vErrors = [err45];
                    } else {
                      vErrors.push(err45);
                    }
                    errors++;
                  }
                }
                if (data18.historyWindow !== void 0) {
                  let data21 = data18.historyWindow;
                  if (!(typeof data21 == "number" && (!(data21 % 1) && !isNaN(data21)) && isFinite(data21))) {
                    const err46 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/properties/config/properties/interaction/properties/conversation/properties/historyWindow/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err46];
                    } else {
                      vErrors.push(err46);
                    }
                    errors++;
                  }
                  if (typeof data21 == "number" && isFinite(data21)) {
                    if (data21 > 100 || isNaN(data21)) {
                      const err47 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/properties/config/properties/interaction/properties/conversation/properties/historyWindow/maximum", keyword: "maximum", params: { comparison: "<=", limit: 100 }, message: "must be <= 100" };
                      if (vErrors === null) {
                        vErrors = [err47];
                      } else {
                        vErrors.push(err47);
                      }
                      errors++;
                    }
                    if (data21 < 1 || isNaN(data21)) {
                      const err48 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/properties/config/properties/interaction/properties/conversation/properties/historyWindow/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                      if (vErrors === null) {
                        vErrors = [err48];
                      } else {
                        vErrors.push(err48);
                      }
                      errors++;
                    }
                  }
                }
              } else {
                const err49 = { instancePath: instancePath + "/config/interaction/conversation", schemaPath: "#/properties/config/properties/interaction/properties/conversation/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err49];
                } else {
                  vErrors.push(err49);
                }
                errors++;
              }
            }
            if (data17.knowledge !== void 0) {
              let data22 = data17.knowledge;
              if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
                if (data22.enabled === void 0) {
                  const err50 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/required", keyword: "required", params: { missingProperty: "enabled" }, message: "must have required property 'enabled'" };
                  if (vErrors === null) {
                    vErrors = [err50];
                  } else {
                    vErrors.push(err50);
                  }
                  errors++;
                }
                for (const key4 in data22) {
                  if (!(key4 === "enabled" || key4 === "scopes" || key4 === "topK" || key4 === "chunkSize" || key4 === "chunkOverlap")) {
                    const err51 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err51];
                    } else {
                      vErrors.push(err51);
                    }
                    errors++;
                  }
                }
                if (data22.enabled !== void 0) {
                  if (true !== data22.enabled) {
                    const err52 = { instancePath: instancePath + "/config/interaction/knowledge/enabled", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/enabled/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err52];
                    } else {
                      vErrors.push(err52);
                    }
                    errors++;
                  }
                }
                if (data22.scopes !== void 0) {
                  let data24 = data22.scopes;
                  if (Array.isArray(data24)) {
                    if (data24.length > 2) {
                      const err53 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/scopes/maxItems", keyword: "maxItems", params: { limit: 2 }, message: "must NOT have more than 2 items" };
                      if (vErrors === null) {
                        vErrors = [err53];
                      } else {
                        vErrors.push(err53);
                      }
                      errors++;
                    }
                    if (data24.length < 1) {
                      const err54 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/scopes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                      if (vErrors === null) {
                        vErrors = [err54];
                      } else {
                        vErrors.push(err54);
                      }
                      errors++;
                    }
                    const len3 = data24.length;
                    for (let i5 = 0; i5 < len3; i5++) {
                      let data25 = data24[i5];
                      if (!(data25 === "app" || data25 === "session")) {
                        const err55 = { instancePath: instancePath + "/config/interaction/knowledge/scopes/" + i5, schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/scopes/items/enum", keyword: "enum", params: { allowedValues: schema27.properties.config.properties.interaction.properties.knowledge.properties.scopes.items.enum }, message: "must be equal to one of the allowed values" };
                        if (vErrors === null) {
                          vErrors = [err55];
                        } else {
                          vErrors.push(err55);
                        }
                        errors++;
                      }
                    }
                    let i6 = data24.length;
                    let j2;
                    if (i6 > 1) {
                      outer1: for (; i6--; ) {
                        for (j2 = i6; j2--; ) {
                          if (func0(data24[i6], data24[j2])) {
                            const err56 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/scopes/uniqueItems", keyword: "uniqueItems", params: { i: i6, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i6 + " are identical)" };
                            if (vErrors === null) {
                              vErrors = [err56];
                            } else {
                              vErrors.push(err56);
                            }
                            errors++;
                            break outer1;
                          }
                        }
                      }
                    }
                  } else {
                    const err57 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/scopes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    if (vErrors === null) {
                      vErrors = [err57];
                    } else {
                      vErrors.push(err57);
                    }
                    errors++;
                  }
                }
                if (data22.topK !== void 0) {
                  let data26 = data22.topK;
                  if (!(typeof data26 == "number" && (!(data26 % 1) && !isNaN(data26)) && isFinite(data26))) {
                    const err58 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/topK/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err58];
                    } else {
                      vErrors.push(err58);
                    }
                    errors++;
                  }
                  if (typeof data26 == "number" && isFinite(data26)) {
                    if (data26 > 20 || isNaN(data26)) {
                      const err59 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/topK/maximum", keyword: "maximum", params: { comparison: "<=", limit: 20 }, message: "must be <= 20" };
                      if (vErrors === null) {
                        vErrors = [err59];
                      } else {
                        vErrors.push(err59);
                      }
                      errors++;
                    }
                    if (data26 < 1 || isNaN(data26)) {
                      const err60 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/topK/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                      if (vErrors === null) {
                        vErrors = [err60];
                      } else {
                        vErrors.push(err60);
                      }
                      errors++;
                    }
                  }
                }
                if (data22.chunkSize !== void 0) {
                  let data27 = data22.chunkSize;
                  if (!(typeof data27 == "number" && (!(data27 % 1) && !isNaN(data27)) && isFinite(data27))) {
                    const err61 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/chunkSize/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err61];
                    } else {
                      vErrors.push(err61);
                    }
                    errors++;
                  }
                  if (typeof data27 == "number" && isFinite(data27)) {
                    if (data27 > 8e3 || isNaN(data27)) {
                      const err62 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/chunkSize/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8e3 }, message: "must be <= 8000" };
                      if (vErrors === null) {
                        vErrors = [err62];
                      } else {
                        vErrors.push(err62);
                      }
                      errors++;
                    }
                    if (data27 < 200 || isNaN(data27)) {
                      const err63 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/chunkSize/minimum", keyword: "minimum", params: { comparison: ">=", limit: 200 }, message: "must be >= 200" };
                      if (vErrors === null) {
                        vErrors = [err63];
                      } else {
                        vErrors.push(err63);
                      }
                      errors++;
                    }
                  }
                }
                if (data22.chunkOverlap !== void 0) {
                  let data28 = data22.chunkOverlap;
                  if (!(typeof data28 == "number" && (!(data28 % 1) && !isNaN(data28)) && isFinite(data28))) {
                    const err64 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/chunkOverlap/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err64];
                    } else {
                      vErrors.push(err64);
                    }
                    errors++;
                  }
                  if (typeof data28 == "number" && isFinite(data28)) {
                    if (data28 > 2e3 || isNaN(data28)) {
                      const err65 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/chunkOverlap/maximum", keyword: "maximum", params: { comparison: "<=", limit: 2e3 }, message: "must be <= 2000" };
                      if (vErrors === null) {
                        vErrors = [err65];
                      } else {
                        vErrors.push(err65);
                      }
                      errors++;
                    }
                    if (data28 < 0 || isNaN(data28)) {
                      const err66 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/properties/chunkOverlap/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                      if (vErrors === null) {
                        vErrors = [err66];
                      } else {
                        vErrors.push(err66);
                      }
                      errors++;
                    }
                  }
                }
              } else {
                const err67 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/properties/config/properties/interaction/properties/knowledge/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err67];
                } else {
                  vErrors.push(err67);
                }
                errors++;
              }
            }
          } else {
            const err68 = { instancePath: instancePath + "/config/interaction", schemaPath: "#/properties/config/properties/interaction/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err68];
            } else {
              vErrors.push(err68);
            }
            errors++;
          }
        }
      } else {
        const err69 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err69];
        } else {
          vErrors.push(err69);
        }
        errors++;
      }
    }
  } else {
    const err70 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err70];
    } else {
      vErrors.push(err70);
    }
    errors++;
  }
  validate18.errors = vErrors;
  return errors === 0;
}
var flowV5 = validate19;
var schema33 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v5/flow.schema.json", "title": "AgComm .ai flow v5", "type": "object", "required": ["entry", "nodes", "edges"], "properties": { "entry": { "$ref": "#/definitions/id" }, "nodes": { "type": "array", "minItems": 1, "maxItems": 2e3, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } }, "edges": { "type": "array", "maxItems": 8e3, "items": { "type": "object", "required": ["from", "to"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "from": { "$ref": "#/definitions/id" }, "to": { "$ref": "#/definitions/id" }, "label": { "type": "string", "maxLength": 200 }, "condition": { "type": "string", "maxLength": 2e3 } } } }, "variables": { "type": "object", "maxProperties": 512 }, "visualizations": { "type": "array", "maxItems": 32, "uniqueItems": true, "items": { "type": "string", "maxLength": 64 } }, "config": { "type": "object", "additionalProperties": false, "properties": { "timeoutMs": { "type": "integer", "minimum": 1, "maximum": 6e5 }, "maxConcurrency": { "type": "integer", "minimum": 1, "maximum": 32 }, "onError": { "enum": ["stop", "continue"] }, "interaction": { "$ref": "#/definitions/interaction" }, "background": { "$ref": "#/definitions/background" } } } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, "jsonValue": {}, "variables": { "type": "object", "maxProperties": 512, "additionalProperties": { "$ref": "#/definitions/jsonValue" } }, "heartbeat": { "type": "object", "required": ["id", "everyMs", "input", "variables", "runOnStart"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "everyMs": { "type": "integer", "minimum": 6e4, "maximum": 864e5 }, "input": { "type": "string", "maxLength": 65536 }, "variables": { "$ref": "#/definitions/variables" }, "runOnStart": { "type": "boolean" } } }, "cronTrigger": { "type": "object", "required": ["id", "expression", "timezone", "input", "variables", "misfireGraceMs"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "expression": { "type": "string", "minLength": 9, "maxLength": 120 }, "timezone": { "type": "string", "minLength": 1, "maxLength": 80 }, "input": { "type": "string", "maxLength": 65536 }, "variables": { "$ref": "#/definitions/variables" }, "misfireGraceMs": { "type": "integer", "minimum": 0, "maximum": 864e5 } } }, "background": { "type": "object", "minProperties": 1, "additionalProperties": false, "properties": { "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 }, "heartbeat": { "$ref": "#/definitions/heartbeat" }, "cron": { "type": "array", "maxItems": 64, "items": { "$ref": "#/definitions/cronTrigger" } } } }, "interaction": { "type": "object", "additionalProperties": false, "properties": { "conversation": { "type": "object", "additionalProperties": false, "properties": { "multiTurn": { "type": "boolean" }, "history": { "type": "boolean" }, "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 } } }, "knowledge": { "type": "object", "required": ["enabled"], "additionalProperties": false, "properties": { "enabled": { "const": true }, "scopes": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["app", "session"] } }, "topK": { "type": "integer", "minimum": 1, "maximum": 20 }, "chunkSize": { "type": "integer", "minimum": 200, "maximum": 8e3 }, "chunkOverlap": { "type": "integer", "minimum": 0, "maximum": 2e3 } } } } } } };
var schema39 = { "type": "object", "additionalProperties": false, "properties": { "conversation": { "type": "object", "additionalProperties": false, "properties": { "multiTurn": { "type": "boolean" }, "history": { "type": "boolean" }, "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 } } }, "knowledge": { "type": "object", "required": ["enabled"], "additionalProperties": false, "properties": { "enabled": { "const": true }, "scopes": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["app", "session"] } }, "topK": { "type": "integer", "minimum": 1, "maximum": 20 }, "chunkSize": { "type": "integer", "minimum": 200, "maximum": 8e3 }, "chunkOverlap": { "type": "integer", "minimum": 0, "maximum": 2e3 } } } } };
function validate22(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length > 512) {
      const err0 = { instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 512 }, message: "must NOT have more than 512 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate22.errors = vErrors;
  return errors === 0;
}
function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.everyMs === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "everyMs" }, message: "must have required property 'everyMs'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.input === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.variables === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "variables" }, message: "must have required property 'variables'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.runOnStart === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runOnStart" }, message: "must have required property 'runOnStart'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "everyMs" || key0 === "input" || key0 === "variables" || key0 === "runOnStart")) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err6 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.everyMs !== void 0) {
      let data1 = data.everyMs;
      if (!(typeof data1 == "number" && (!(data1 % 1) && !isNaN(data1)) && isFinite(data1))) {
        const err8 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      if (typeof data1 == "number" && isFinite(data1)) {
        if (data1 > 864e5 || isNaN(data1)) {
          const err9 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 864e5 }, message: "must be <= 86400000" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (data1 < 6e4 || isNaN(data1)) {
          const err10 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 6e4 }, message: "must be >= 60000" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      }
    }
    if (data.input !== void 0) {
      let data2 = data.input;
      if (typeof data2 === "string") {
        if (func3(data2) > 65536) {
          const err11 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/maxLength", keyword: "maxLength", params: { limit: 65536 }, message: "must NOT have more than 65536 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      if (!validate22(data.variables, { instancePath: instancePath + "/variables", parentData: data, parentDataProperty: "variables", rootData })) {
        vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
        errors = vErrors.length;
      }
    }
    if (data.runOnStart !== void 0) {
      if (typeof data.runOnStart !== "boolean") {
        const err13 = { instancePath: instancePath + "/runOnStart", schemaPath: "#/properties/runOnStart/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  validate21.errors = vErrors;
  return errors === 0;
}
function validate25(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.expression === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "expression" }, message: "must have required property 'expression'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.timezone === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "timezone" }, message: "must have required property 'timezone'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.input === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.variables === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "variables" }, message: "must have required property 'variables'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.misfireGraceMs === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "misfireGraceMs" }, message: "must have required property 'misfireGraceMs'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "expression" || key0 === "timezone" || key0 === "input" || key0 === "variables" || key0 === "misfireGraceMs")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.expression !== void 0) {
      let data1 = data.expression;
      if (typeof data1 === "string") {
        if (func3(data1) > 120) {
          const err9 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (func3(data1) < 9) {
          const err10 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/minLength", keyword: "minLength", params: { limit: 9 }, message: "must NOT have fewer than 9 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.timezone !== void 0) {
      let data2 = data.timezone;
      if (typeof data2 === "string") {
        if (func3(data2) > 80) {
          const err12 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/maxLength", keyword: "maxLength", params: { limit: 80 }, message: "must NOT have more than 80 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (func3(data2) < 1) {
          const err13 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.input !== void 0) {
      let data3 = data.input;
      if (typeof data3 === "string") {
        if (func3(data3) > 65536) {
          const err15 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/maxLength", keyword: "maxLength", params: { limit: 65536 }, message: "must NOT have more than 65536 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      if (!validate22(data.variables, { instancePath: instancePath + "/variables", parentData: data, parentDataProperty: "variables", rootData })) {
        vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
        errors = vErrors.length;
      }
    }
    if (data.misfireGraceMs !== void 0) {
      let data5 = data.misfireGraceMs;
      if (!(typeof data5 == "number" && (!(data5 % 1) && !isNaN(data5)) && isFinite(data5))) {
        const err17 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (typeof data5 == "number" && isFinite(data5)) {
        if (data5 > 864e5 || isNaN(data5)) {
          const err18 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 864e5 }, message: "must be <= 86400000" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        if (data5 < 0 || isNaN(data5)) {
          const err19 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      }
    }
  } else {
    const err20 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err20];
    } else {
      vErrors.push(err20);
    }
    errors++;
  }
  validate25.errors = vErrors;
  return errors === 0;
}
function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length < 1) {
      const err0 = { instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "historyWindow" || key0 === "heartbeat" || key0 === "cron")) {
        const err1 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    if (data.historyWindow !== void 0) {
      let data0 = data.historyWindow;
      if (!(typeof data0 == "number" && (!(data0 % 1) && !isNaN(data0)) && isFinite(data0))) {
        const err2 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (typeof data0 == "number" && isFinite(data0)) {
        if (data0 > 100 || isNaN(data0)) {
          const err3 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/maximum", keyword: "maximum", params: { comparison: "<=", limit: 100 }, message: "must be <= 100" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        if (data0 < 1 || isNaN(data0)) {
          const err4 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
    }
    if (data.heartbeat !== void 0) {
      if (!validate21(data.heartbeat, { instancePath: instancePath + "/heartbeat", parentData: data, parentDataProperty: "heartbeat", rootData })) {
        vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
        errors = vErrors.length;
      }
    }
    if (data.cron !== void 0) {
      let data2 = data.cron;
      if (Array.isArray(data2)) {
        if (data2.length > 64) {
          const err5 = { instancePath: instancePath + "/cron", schemaPath: "#/properties/cron/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        const len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate25(data2[i0], { instancePath: instancePath + "/cron/" + i0, parentData: data2, parentDataProperty: i0, rootData })) {
            vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err6 = { instancePath: instancePath + "/cron", schemaPath: "#/properties/cron/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
function validate19(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.entry === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.nodes === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "nodes" }, message: "must have required property 'nodes'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.edges === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edges" }, message: "must have required property 'edges'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "entry" || key0 === "nodes" || key0 === "edges" || key0 === "variables" || key0 === "visualizations" || key0 === "config")) {
        const err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.entry !== void 0) {
      let data0 = data.entry;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err4 = { instancePath: instancePath + "/entry", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/entry", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.nodes !== void 0) {
      let data1 = data.nodes;
      if (Array.isArray(data1)) {
        if (data1.length > 2e3) {
          const err6 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/maxItems", keyword: "maxItems", params: { limit: 2e3 }, message: "must NOT have more than 2000 items" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data1.length < 1) {
          const err7 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (typeof data2 === "string") {
            if (!pattern0.test(data2)) {
              const err8 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        let i1 = data1.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data1[i1], data1[j0])) {
                const err10 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err11 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.edges !== void 0) {
      let data3 = data.edges;
      if (Array.isArray(data3)) {
        if (data3.length > 8e3) {
          const err12 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/maxItems", keyword: "maxItems", params: { limit: 8e3 }, message: "must NOT have more than 8000 items" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        const len1 = data3.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data4 = data3[i2];
          if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
            if (data4.from === void 0) {
              const err13 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
            if (data4.to === void 0) {
              const err14 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
            for (const key1 in data4) {
              if (!(key1 === "id" || key1 === "from" || key1 === "to" || key1 === "label" || key1 === "condition")) {
                const err15 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
            }
            if (data4.id !== void 0) {
              let data5 = data4.id;
              if (typeof data5 === "string") {
                if (!pattern0.test(data5)) {
                  const err16 = { instancePath: instancePath + "/edges/" + i2 + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err16];
                  } else {
                    vErrors.push(err16);
                  }
                  errors++;
                }
              } else {
                const err17 = { instancePath: instancePath + "/edges/" + i2 + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
            if (data4.from !== void 0) {
              let data6 = data4.from;
              if (typeof data6 === "string") {
                if (!pattern0.test(data6)) {
                  const err18 = { instancePath: instancePath + "/edges/" + i2 + "/from", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err18];
                  } else {
                    vErrors.push(err18);
                  }
                  errors++;
                }
              } else {
                const err19 = { instancePath: instancePath + "/edges/" + i2 + "/from", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err19];
                } else {
                  vErrors.push(err19);
                }
                errors++;
              }
            }
            if (data4.to !== void 0) {
              let data7 = data4.to;
              if (typeof data7 === "string") {
                if (!pattern0.test(data7)) {
                  const err20 = { instancePath: instancePath + "/edges/" + i2 + "/to", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
              } else {
                const err21 = { instancePath: instancePath + "/edges/" + i2 + "/to", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
            if (data4.label !== void 0) {
              let data8 = data4.label;
              if (typeof data8 === "string") {
                if (func3(data8) > 200) {
                  const err22 = { instancePath: instancePath + "/edges/" + i2 + "/label", schemaPath: "#/properties/edges/items/properties/label/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
                  if (vErrors === null) {
                    vErrors = [err22];
                  } else {
                    vErrors.push(err22);
                  }
                  errors++;
                }
              } else {
                const err23 = { instancePath: instancePath + "/edges/" + i2 + "/label", schemaPath: "#/properties/edges/items/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
            }
            if (data4.condition !== void 0) {
              let data9 = data4.condition;
              if (typeof data9 === "string") {
                if (func3(data9) > 2e3) {
                  const err24 = { instancePath: instancePath + "/edges/" + i2 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
                  if (vErrors === null) {
                    vErrors = [err24];
                  } else {
                    vErrors.push(err24);
                  }
                  errors++;
                }
              } else {
                const err25 = { instancePath: instancePath + "/edges/" + i2 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
          } else {
            const err26 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      let data10 = data.variables;
      if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
        if (Object.keys(data10).length > 512) {
          const err28 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/maxProperties", keyword: "maxProperties", params: { limit: 512 }, message: "must NOT have more than 512 properties" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
      } else {
        const err29 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.visualizations !== void 0) {
      let data11 = data.visualizations;
      if (Array.isArray(data11)) {
        if (data11.length > 32) {
          const err30 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        const len2 = data11.length;
        for (let i3 = 0; i3 < len2; i3++) {
          let data12 = data11[i3];
          if (typeof data12 === "string") {
            if (func3(data12) > 64) {
              const err31 = { instancePath: instancePath + "/visualizations/" + i3, schemaPath: "#/properties/visualizations/items/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
          } else {
            const err32 = { instancePath: instancePath + "/visualizations/" + i3, schemaPath: "#/properties/visualizations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        let i4 = data11.length;
        let j1;
        if (i4 > 1) {
          const indices0 = {};
          for (; i4--; ) {
            let item0 = data11[i4];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j1 = indices0[item0];
              const err33 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i4 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
              break;
            }
            indices0[item0] = i4;
          }
        }
      } else {
        const err34 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
    if (data.config !== void 0) {
      let data13 = data.config;
      if (data13 && typeof data13 == "object" && !Array.isArray(data13)) {
        for (const key2 in data13) {
          if (!(key2 === "timeoutMs" || key2 === "maxConcurrency" || key2 === "onError" || key2 === "interaction" || key2 === "background")) {
            const err35 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
        if (data13.timeoutMs !== void 0) {
          let data14 = data13.timeoutMs;
          if (!(typeof data14 == "number" && (!(data14 % 1) && !isNaN(data14)) && isFinite(data14))) {
            const err36 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err36];
            } else {
              vErrors.push(err36);
            }
            errors++;
          }
          if (typeof data14 == "number" && isFinite(data14)) {
            if (data14 > 6e5 || isNaN(data14)) {
              const err37 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e5 }, message: "must be <= 600000" };
              if (vErrors === null) {
                vErrors = [err37];
              } else {
                vErrors.push(err37);
              }
              errors++;
            }
            if (data14 < 1 || isNaN(data14)) {
              const err38 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err38];
              } else {
                vErrors.push(err38);
              }
              errors++;
            }
          }
        }
        if (data13.maxConcurrency !== void 0) {
          let data15 = data13.maxConcurrency;
          if (!(typeof data15 == "number" && (!(data15 % 1) && !isNaN(data15)) && isFinite(data15))) {
            const err39 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
          if (typeof data15 == "number" && isFinite(data15)) {
            if (data15 > 32 || isNaN(data15)) {
              const err40 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/maximum", keyword: "maximum", params: { comparison: "<=", limit: 32 }, message: "must be <= 32" };
              if (vErrors === null) {
                vErrors = [err40];
              } else {
                vErrors.push(err40);
              }
              errors++;
            }
            if (data15 < 1 || isNaN(data15)) {
              const err41 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err41];
              } else {
                vErrors.push(err41);
              }
              errors++;
            }
          }
        }
        if (data13.onError !== void 0) {
          let data16 = data13.onError;
          if (!(data16 === "stop" || data16 === "continue")) {
            const err42 = { instancePath: instancePath + "/config/onError", schemaPath: "#/properties/config/properties/onError/enum", keyword: "enum", params: { allowedValues: schema33.properties.config.properties.onError.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
        }
        if (data13.interaction !== void 0) {
          let data17 = data13.interaction;
          if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
            for (const key3 in data17) {
              if (!(key3 === "conversation" || key3 === "knowledge")) {
                const err43 = { instancePath: instancePath + "/config/interaction", schemaPath: "#/definitions/interaction/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err43];
                } else {
                  vErrors.push(err43);
                }
                errors++;
              }
            }
            if (data17.conversation !== void 0) {
              let data18 = data17.conversation;
              if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
                for (const key4 in data18) {
                  if (!(key4 === "multiTurn" || key4 === "history" || key4 === "historyWindow")) {
                    const err44 = { instancePath: instancePath + "/config/interaction/conversation", schemaPath: "#/definitions/interaction/properties/conversation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err44];
                    } else {
                      vErrors.push(err44);
                    }
                    errors++;
                  }
                }
                if (data18.multiTurn !== void 0) {
                  if (typeof data18.multiTurn !== "boolean") {
                    const err45 = { instancePath: instancePath + "/config/interaction/conversation/multiTurn", schemaPath: "#/definitions/interaction/properties/conversation/properties/multiTurn/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                    if (vErrors === null) {
                      vErrors = [err45];
                    } else {
                      vErrors.push(err45);
                    }
                    errors++;
                  }
                }
                if (data18.history !== void 0) {
                  if (typeof data18.history !== "boolean") {
                    const err46 = { instancePath: instancePath + "/config/interaction/conversation/history", schemaPath: "#/definitions/interaction/properties/conversation/properties/history/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                    if (vErrors === null) {
                      vErrors = [err46];
                    } else {
                      vErrors.push(err46);
                    }
                    errors++;
                  }
                }
                if (data18.historyWindow !== void 0) {
                  let data21 = data18.historyWindow;
                  if (!(typeof data21 == "number" && (!(data21 % 1) && !isNaN(data21)) && isFinite(data21))) {
                    const err47 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err47];
                    } else {
                      vErrors.push(err47);
                    }
                    errors++;
                  }
                  if (typeof data21 == "number" && isFinite(data21)) {
                    if (data21 > 100 || isNaN(data21)) {
                      const err48 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/maximum", keyword: "maximum", params: { comparison: "<=", limit: 100 }, message: "must be <= 100" };
                      if (vErrors === null) {
                        vErrors = [err48];
                      } else {
                        vErrors.push(err48);
                      }
                      errors++;
                    }
                    if (data21 < 1 || isNaN(data21)) {
                      const err49 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                      if (vErrors === null) {
                        vErrors = [err49];
                      } else {
                        vErrors.push(err49);
                      }
                      errors++;
                    }
                  }
                }
              } else {
                const err50 = { instancePath: instancePath + "/config/interaction/conversation", schemaPath: "#/definitions/interaction/properties/conversation/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err50];
                } else {
                  vErrors.push(err50);
                }
                errors++;
              }
            }
            if (data17.knowledge !== void 0) {
              let data22 = data17.knowledge;
              if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
                if (data22.enabled === void 0) {
                  const err51 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/required", keyword: "required", params: { missingProperty: "enabled" }, message: "must have required property 'enabled'" };
                  if (vErrors === null) {
                    vErrors = [err51];
                  } else {
                    vErrors.push(err51);
                  }
                  errors++;
                }
                for (const key5 in data22) {
                  if (!(key5 === "enabled" || key5 === "scopes" || key5 === "topK" || key5 === "chunkSize" || key5 === "chunkOverlap")) {
                    const err52 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err52];
                    } else {
                      vErrors.push(err52);
                    }
                    errors++;
                  }
                }
                if (data22.enabled !== void 0) {
                  if (true !== data22.enabled) {
                    const err53 = { instancePath: instancePath + "/config/interaction/knowledge/enabled", schemaPath: "#/definitions/interaction/properties/knowledge/properties/enabled/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err53];
                    } else {
                      vErrors.push(err53);
                    }
                    errors++;
                  }
                }
                if (data22.scopes !== void 0) {
                  let data24 = data22.scopes;
                  if (Array.isArray(data24)) {
                    if (data24.length > 2) {
                      const err54 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/maxItems", keyword: "maxItems", params: { limit: 2 }, message: "must NOT have more than 2 items" };
                      if (vErrors === null) {
                        vErrors = [err54];
                      } else {
                        vErrors.push(err54);
                      }
                      errors++;
                    }
                    if (data24.length < 1) {
                      const err55 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                      if (vErrors === null) {
                        vErrors = [err55];
                      } else {
                        vErrors.push(err55);
                      }
                      errors++;
                    }
                    const len3 = data24.length;
                    for (let i5 = 0; i5 < len3; i5++) {
                      let data25 = data24[i5];
                      if (!(data25 === "app" || data25 === "session")) {
                        const err56 = { instancePath: instancePath + "/config/interaction/knowledge/scopes/" + i5, schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/items/enum", keyword: "enum", params: { allowedValues: schema39.properties.knowledge.properties.scopes.items.enum }, message: "must be equal to one of the allowed values" };
                        if (vErrors === null) {
                          vErrors = [err56];
                        } else {
                          vErrors.push(err56);
                        }
                        errors++;
                      }
                    }
                    let i6 = data24.length;
                    let j2;
                    if (i6 > 1) {
                      outer1: for (; i6--; ) {
                        for (j2 = i6; j2--; ) {
                          if (func0(data24[i6], data24[j2])) {
                            const err57 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/uniqueItems", keyword: "uniqueItems", params: { i: i6, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i6 + " are identical)" };
                            if (vErrors === null) {
                              vErrors = [err57];
                            } else {
                              vErrors.push(err57);
                            }
                            errors++;
                            break outer1;
                          }
                        }
                      }
                    }
                  } else {
                    const err58 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    if (vErrors === null) {
                      vErrors = [err58];
                    } else {
                      vErrors.push(err58);
                    }
                    errors++;
                  }
                }
                if (data22.topK !== void 0) {
                  let data26 = data22.topK;
                  if (!(typeof data26 == "number" && (!(data26 % 1) && !isNaN(data26)) && isFinite(data26))) {
                    const err59 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err59];
                    } else {
                      vErrors.push(err59);
                    }
                    errors++;
                  }
                  if (typeof data26 == "number" && isFinite(data26)) {
                    if (data26 > 20 || isNaN(data26)) {
                      const err60 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/maximum", keyword: "maximum", params: { comparison: "<=", limit: 20 }, message: "must be <= 20" };
                      if (vErrors === null) {
                        vErrors = [err60];
                      } else {
                        vErrors.push(err60);
                      }
                      errors++;
                    }
                    if (data26 < 1 || isNaN(data26)) {
                      const err61 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                      if (vErrors === null) {
                        vErrors = [err61];
                      } else {
                        vErrors.push(err61);
                      }
                      errors++;
                    }
                  }
                }
                if (data22.chunkSize !== void 0) {
                  let data27 = data22.chunkSize;
                  if (!(typeof data27 == "number" && (!(data27 % 1) && !isNaN(data27)) && isFinite(data27))) {
                    const err62 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err62];
                    } else {
                      vErrors.push(err62);
                    }
                    errors++;
                  }
                  if (typeof data27 == "number" && isFinite(data27)) {
                    if (data27 > 8e3 || isNaN(data27)) {
                      const err63 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8e3 }, message: "must be <= 8000" };
                      if (vErrors === null) {
                        vErrors = [err63];
                      } else {
                        vErrors.push(err63);
                      }
                      errors++;
                    }
                    if (data27 < 200 || isNaN(data27)) {
                      const err64 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/minimum", keyword: "minimum", params: { comparison: ">=", limit: 200 }, message: "must be >= 200" };
                      if (vErrors === null) {
                        vErrors = [err64];
                      } else {
                        vErrors.push(err64);
                      }
                      errors++;
                    }
                  }
                }
                if (data22.chunkOverlap !== void 0) {
                  let data28 = data22.chunkOverlap;
                  if (!(typeof data28 == "number" && (!(data28 % 1) && !isNaN(data28)) && isFinite(data28))) {
                    const err65 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err65];
                    } else {
                      vErrors.push(err65);
                    }
                    errors++;
                  }
                  if (typeof data28 == "number" && isFinite(data28)) {
                    if (data28 > 2e3 || isNaN(data28)) {
                      const err66 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/maximum", keyword: "maximum", params: { comparison: "<=", limit: 2e3 }, message: "must be <= 2000" };
                      if (vErrors === null) {
                        vErrors = [err66];
                      } else {
                        vErrors.push(err66);
                      }
                      errors++;
                    }
                    if (data28 < 0 || isNaN(data28)) {
                      const err67 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                      if (vErrors === null) {
                        vErrors = [err67];
                      } else {
                        vErrors.push(err67);
                      }
                      errors++;
                    }
                  }
                }
              } else {
                const err68 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err68];
                } else {
                  vErrors.push(err68);
                }
                errors++;
              }
            }
          } else {
            const err69 = { instancePath: instancePath + "/config/interaction", schemaPath: "#/definitions/interaction/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err69];
            } else {
              vErrors.push(err69);
            }
            errors++;
          }
        }
        if (data13.background !== void 0) {
          if (!validate20(data13.background, { instancePath: instancePath + "/config/background", parentData: data13, parentDataProperty: "background", rootData })) {
            vErrors = vErrors === null ? validate20.errors : vErrors.concat(validate20.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err70 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err70];
        } else {
          vErrors.push(err70);
        }
        errors++;
      }
    }
  } else {
    const err71 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err71];
    } else {
      vErrors.push(err71);
    }
    errors++;
  }
  validate19.errors = vErrors;
  return errors === 0;
}
var flowV6 = validate29;
function validate29(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (!validate19(data, { instancePath, parentData, parentDataProperty, rootData })) {
    vErrors = vErrors === null ? validate19.errors : vErrors.concat(validate19.errors);
    errors = vErrors.length;
  }
  validate29.errors = vErrors;
  return errors === 0;
}
var flowV7 = validate31;
var schema48 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v7/flow.schema.json", "title": "AgComm .ai flow v7", "type": "object", "required": ["entry", "nodes", "edges"], "properties": { "entry": { "$ref": "#/definitions/id" }, "nodes": { "type": "array", "minItems": 1, "maxItems": 2e3, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } }, "edges": { "type": "array", "maxItems": 8e3, "items": { "type": "object", "required": ["from", "to"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "from": { "$ref": "#/definitions/id" }, "to": { "$ref": "#/definitions/id" }, "label": { "type": "string", "maxLength": 200 }, "condition": { "type": "string", "maxLength": 2e3 } } } }, "variables": { "type": "object", "maxProperties": 512 }, "visualizations": { "type": "array", "maxItems": 32, "uniqueItems": true, "items": { "type": "string", "maxLength": 64 } }, "config": { "type": "object", "additionalProperties": false, "properties": { "timeoutMs": { "type": "integer", "minimum": 1, "maximum": 6e5 }, "maxConcurrency": { "type": "integer", "minimum": 1, "maximum": 32 }, "onError": { "enum": ["stop", "continue"] }, "interaction": { "$ref": "#/definitions/interaction" }, "background": { "$ref": "#/definitions/background" } } } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, "jsonValue": {}, "variables": { "type": "object", "maxProperties": 512, "additionalProperties": { "$ref": "#/definitions/jsonValue" } }, "heartbeat": { "type": "object", "required": ["id", "everyMs", "input", "variables", "runOnStart"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "everyMs": { "type": "integer", "minimum": 6e4, "maximum": 864e5 }, "input": { "type": "string", "maxLength": 65536 }, "variables": { "$ref": "#/definitions/variables" }, "runOnStart": { "type": "boolean" } } }, "cronTrigger": { "type": "object", "required": ["id", "expression", "timezone", "input", "variables", "misfireGraceMs"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "expression": { "type": "string", "minLength": 9, "maxLength": 120 }, "timezone": { "type": "string", "minLength": 1, "maxLength": 80 }, "input": { "type": "string", "maxLength": 65536 }, "variables": { "$ref": "#/definitions/variables" }, "misfireGraceMs": { "type": "integer", "minimum": 0, "maximum": 864e5 } } }, "background": { "type": "object", "minProperties": 1, "additionalProperties": false, "properties": { "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 }, "heartbeat": { "$ref": "#/definitions/heartbeat" }, "cron": { "type": "array", "maxItems": 64, "items": { "$ref": "#/definitions/cronTrigger" } } } }, "interaction": { "type": "object", "additionalProperties": false, "properties": { "conversation": { "type": "object", "additionalProperties": false, "properties": { "multiTurn": { "type": "boolean" }, "history": { "type": "boolean" }, "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 } } }, "knowledge": { "type": "object", "required": ["enabled"], "additionalProperties": false, "properties": { "enabled": { "const": true }, "scopes": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["app", "session"] } }, "topK": { "type": "integer", "minimum": 1, "maximum": 20 }, "chunkSize": { "type": "integer", "minimum": 200, "maximum": 8e3 }, "chunkOverlap": { "type": "integer", "minimum": 0, "maximum": 2e3 } } }, "streaming": { "type": "object", "required": ["defaultMode"], "additionalProperties": false, "properties": { "defaultMode": { "enum": ["text", "events"] } } } } } } };
var schema54 = { "type": "object", "additionalProperties": false, "properties": { "conversation": { "type": "object", "additionalProperties": false, "properties": { "multiTurn": { "type": "boolean" }, "history": { "type": "boolean" }, "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 } } }, "knowledge": { "type": "object", "required": ["enabled"], "additionalProperties": false, "properties": { "enabled": { "const": true }, "scopes": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["app", "session"] } }, "topK": { "type": "integer", "minimum": 1, "maximum": 20 }, "chunkSize": { "type": "integer", "minimum": 200, "maximum": 8e3 }, "chunkOverlap": { "type": "integer", "minimum": 0, "maximum": 2e3 } } }, "streaming": { "type": "object", "required": ["defaultMode"], "additionalProperties": false, "properties": { "defaultMode": { "enum": ["text", "events"] } } } } };
function validate34(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length > 512) {
      const err0 = { instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 512 }, message: "must NOT have more than 512 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate34.errors = vErrors;
  return errors === 0;
}
function validate33(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.everyMs === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "everyMs" }, message: "must have required property 'everyMs'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.input === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.variables === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "variables" }, message: "must have required property 'variables'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.runOnStart === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runOnStart" }, message: "must have required property 'runOnStart'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "everyMs" || key0 === "input" || key0 === "variables" || key0 === "runOnStart")) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err6 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.everyMs !== void 0) {
      let data1 = data.everyMs;
      if (!(typeof data1 == "number" && (!(data1 % 1) && !isNaN(data1)) && isFinite(data1))) {
        const err8 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      if (typeof data1 == "number" && isFinite(data1)) {
        if (data1 > 864e5 || isNaN(data1)) {
          const err9 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 864e5 }, message: "must be <= 86400000" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (data1 < 6e4 || isNaN(data1)) {
          const err10 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 6e4 }, message: "must be >= 60000" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      }
    }
    if (data.input !== void 0) {
      let data2 = data.input;
      if (typeof data2 === "string") {
        if (func3(data2) > 65536) {
          const err11 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/maxLength", keyword: "maxLength", params: { limit: 65536 }, message: "must NOT have more than 65536 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      if (!validate34(data.variables, { instancePath: instancePath + "/variables", parentData: data, parentDataProperty: "variables", rootData })) {
        vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
        errors = vErrors.length;
      }
    }
    if (data.runOnStart !== void 0) {
      if (typeof data.runOnStart !== "boolean") {
        const err13 = { instancePath: instancePath + "/runOnStart", schemaPath: "#/properties/runOnStart/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  validate33.errors = vErrors;
  return errors === 0;
}
function validate37(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.expression === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "expression" }, message: "must have required property 'expression'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.timezone === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "timezone" }, message: "must have required property 'timezone'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.input === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.variables === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "variables" }, message: "must have required property 'variables'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.misfireGraceMs === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "misfireGraceMs" }, message: "must have required property 'misfireGraceMs'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "expression" || key0 === "timezone" || key0 === "input" || key0 === "variables" || key0 === "misfireGraceMs")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.expression !== void 0) {
      let data1 = data.expression;
      if (typeof data1 === "string") {
        if (func3(data1) > 120) {
          const err9 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (func3(data1) < 9) {
          const err10 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/minLength", keyword: "minLength", params: { limit: 9 }, message: "must NOT have fewer than 9 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.timezone !== void 0) {
      let data2 = data.timezone;
      if (typeof data2 === "string") {
        if (func3(data2) > 80) {
          const err12 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/maxLength", keyword: "maxLength", params: { limit: 80 }, message: "must NOT have more than 80 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (func3(data2) < 1) {
          const err13 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.input !== void 0) {
      let data3 = data.input;
      if (typeof data3 === "string") {
        if (func3(data3) > 65536) {
          const err15 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/maxLength", keyword: "maxLength", params: { limit: 65536 }, message: "must NOT have more than 65536 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      if (!validate34(data.variables, { instancePath: instancePath + "/variables", parentData: data, parentDataProperty: "variables", rootData })) {
        vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
        errors = vErrors.length;
      }
    }
    if (data.misfireGraceMs !== void 0) {
      let data5 = data.misfireGraceMs;
      if (!(typeof data5 == "number" && (!(data5 % 1) && !isNaN(data5)) && isFinite(data5))) {
        const err17 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (typeof data5 == "number" && isFinite(data5)) {
        if (data5 > 864e5 || isNaN(data5)) {
          const err18 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 864e5 }, message: "must be <= 86400000" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        if (data5 < 0 || isNaN(data5)) {
          const err19 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      }
    }
  } else {
    const err20 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err20];
    } else {
      vErrors.push(err20);
    }
    errors++;
  }
  validate37.errors = vErrors;
  return errors === 0;
}
function validate32(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length < 1) {
      const err0 = { instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "historyWindow" || key0 === "heartbeat" || key0 === "cron")) {
        const err1 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    if (data.historyWindow !== void 0) {
      let data0 = data.historyWindow;
      if (!(typeof data0 == "number" && (!(data0 % 1) && !isNaN(data0)) && isFinite(data0))) {
        const err2 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (typeof data0 == "number" && isFinite(data0)) {
        if (data0 > 100 || isNaN(data0)) {
          const err3 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/maximum", keyword: "maximum", params: { comparison: "<=", limit: 100 }, message: "must be <= 100" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        if (data0 < 1 || isNaN(data0)) {
          const err4 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
    }
    if (data.heartbeat !== void 0) {
      if (!validate33(data.heartbeat, { instancePath: instancePath + "/heartbeat", parentData: data, parentDataProperty: "heartbeat", rootData })) {
        vErrors = vErrors === null ? validate33.errors : vErrors.concat(validate33.errors);
        errors = vErrors.length;
      }
    }
    if (data.cron !== void 0) {
      let data2 = data.cron;
      if (Array.isArray(data2)) {
        if (data2.length > 64) {
          const err5 = { instancePath: instancePath + "/cron", schemaPath: "#/properties/cron/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        const len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate37(data2[i0], { instancePath: instancePath + "/cron/" + i0, parentData: data2, parentDataProperty: i0, rootData })) {
            vErrors = vErrors === null ? validate37.errors : vErrors.concat(validate37.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err6 = { instancePath: instancePath + "/cron", schemaPath: "#/properties/cron/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate32.errors = vErrors;
  return errors === 0;
}
function validate31(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.entry === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.nodes === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "nodes" }, message: "must have required property 'nodes'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.edges === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edges" }, message: "must have required property 'edges'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "entry" || key0 === "nodes" || key0 === "edges" || key0 === "variables" || key0 === "visualizations" || key0 === "config")) {
        const err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.entry !== void 0) {
      let data0 = data.entry;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err4 = { instancePath: instancePath + "/entry", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/entry", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.nodes !== void 0) {
      let data1 = data.nodes;
      if (Array.isArray(data1)) {
        if (data1.length > 2e3) {
          const err6 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/maxItems", keyword: "maxItems", params: { limit: 2e3 }, message: "must NOT have more than 2000 items" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data1.length < 1) {
          const err7 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (typeof data2 === "string") {
            if (!pattern0.test(data2)) {
              const err8 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        let i1 = data1.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data1[i1], data1[j0])) {
                const err10 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err11 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.edges !== void 0) {
      let data3 = data.edges;
      if (Array.isArray(data3)) {
        if (data3.length > 8e3) {
          const err12 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/maxItems", keyword: "maxItems", params: { limit: 8e3 }, message: "must NOT have more than 8000 items" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        const len1 = data3.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data4 = data3[i2];
          if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
            if (data4.from === void 0) {
              const err13 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
            if (data4.to === void 0) {
              const err14 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
            for (const key1 in data4) {
              if (!(key1 === "id" || key1 === "from" || key1 === "to" || key1 === "label" || key1 === "condition")) {
                const err15 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
            }
            if (data4.id !== void 0) {
              let data5 = data4.id;
              if (typeof data5 === "string") {
                if (!pattern0.test(data5)) {
                  const err16 = { instancePath: instancePath + "/edges/" + i2 + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err16];
                  } else {
                    vErrors.push(err16);
                  }
                  errors++;
                }
              } else {
                const err17 = { instancePath: instancePath + "/edges/" + i2 + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
            if (data4.from !== void 0) {
              let data6 = data4.from;
              if (typeof data6 === "string") {
                if (!pattern0.test(data6)) {
                  const err18 = { instancePath: instancePath + "/edges/" + i2 + "/from", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err18];
                  } else {
                    vErrors.push(err18);
                  }
                  errors++;
                }
              } else {
                const err19 = { instancePath: instancePath + "/edges/" + i2 + "/from", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err19];
                } else {
                  vErrors.push(err19);
                }
                errors++;
              }
            }
            if (data4.to !== void 0) {
              let data7 = data4.to;
              if (typeof data7 === "string") {
                if (!pattern0.test(data7)) {
                  const err20 = { instancePath: instancePath + "/edges/" + i2 + "/to", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
              } else {
                const err21 = { instancePath: instancePath + "/edges/" + i2 + "/to", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
            if (data4.label !== void 0) {
              let data8 = data4.label;
              if (typeof data8 === "string") {
                if (func3(data8) > 200) {
                  const err22 = { instancePath: instancePath + "/edges/" + i2 + "/label", schemaPath: "#/properties/edges/items/properties/label/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
                  if (vErrors === null) {
                    vErrors = [err22];
                  } else {
                    vErrors.push(err22);
                  }
                  errors++;
                }
              } else {
                const err23 = { instancePath: instancePath + "/edges/" + i2 + "/label", schemaPath: "#/properties/edges/items/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
            }
            if (data4.condition !== void 0) {
              let data9 = data4.condition;
              if (typeof data9 === "string") {
                if (func3(data9) > 2e3) {
                  const err24 = { instancePath: instancePath + "/edges/" + i2 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
                  if (vErrors === null) {
                    vErrors = [err24];
                  } else {
                    vErrors.push(err24);
                  }
                  errors++;
                }
              } else {
                const err25 = { instancePath: instancePath + "/edges/" + i2 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
          } else {
            const err26 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      let data10 = data.variables;
      if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
        if (Object.keys(data10).length > 512) {
          const err28 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/maxProperties", keyword: "maxProperties", params: { limit: 512 }, message: "must NOT have more than 512 properties" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
      } else {
        const err29 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.visualizations !== void 0) {
      let data11 = data.visualizations;
      if (Array.isArray(data11)) {
        if (data11.length > 32) {
          const err30 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        const len2 = data11.length;
        for (let i3 = 0; i3 < len2; i3++) {
          let data12 = data11[i3];
          if (typeof data12 === "string") {
            if (func3(data12) > 64) {
              const err31 = { instancePath: instancePath + "/visualizations/" + i3, schemaPath: "#/properties/visualizations/items/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
          } else {
            const err32 = { instancePath: instancePath + "/visualizations/" + i3, schemaPath: "#/properties/visualizations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        let i4 = data11.length;
        let j1;
        if (i4 > 1) {
          const indices0 = {};
          for (; i4--; ) {
            let item0 = data11[i4];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j1 = indices0[item0];
              const err33 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i4 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
              break;
            }
            indices0[item0] = i4;
          }
        }
      } else {
        const err34 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
    if (data.config !== void 0) {
      let data13 = data.config;
      if (data13 && typeof data13 == "object" && !Array.isArray(data13)) {
        for (const key2 in data13) {
          if (!(key2 === "timeoutMs" || key2 === "maxConcurrency" || key2 === "onError" || key2 === "interaction" || key2 === "background")) {
            const err35 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
        if (data13.timeoutMs !== void 0) {
          let data14 = data13.timeoutMs;
          if (!(typeof data14 == "number" && (!(data14 % 1) && !isNaN(data14)) && isFinite(data14))) {
            const err36 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err36];
            } else {
              vErrors.push(err36);
            }
            errors++;
          }
          if (typeof data14 == "number" && isFinite(data14)) {
            if (data14 > 6e5 || isNaN(data14)) {
              const err37 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e5 }, message: "must be <= 600000" };
              if (vErrors === null) {
                vErrors = [err37];
              } else {
                vErrors.push(err37);
              }
              errors++;
            }
            if (data14 < 1 || isNaN(data14)) {
              const err38 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err38];
              } else {
                vErrors.push(err38);
              }
              errors++;
            }
          }
        }
        if (data13.maxConcurrency !== void 0) {
          let data15 = data13.maxConcurrency;
          if (!(typeof data15 == "number" && (!(data15 % 1) && !isNaN(data15)) && isFinite(data15))) {
            const err39 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
          if (typeof data15 == "number" && isFinite(data15)) {
            if (data15 > 32 || isNaN(data15)) {
              const err40 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/maximum", keyword: "maximum", params: { comparison: "<=", limit: 32 }, message: "must be <= 32" };
              if (vErrors === null) {
                vErrors = [err40];
              } else {
                vErrors.push(err40);
              }
              errors++;
            }
            if (data15 < 1 || isNaN(data15)) {
              const err41 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err41];
              } else {
                vErrors.push(err41);
              }
              errors++;
            }
          }
        }
        if (data13.onError !== void 0) {
          let data16 = data13.onError;
          if (!(data16 === "stop" || data16 === "continue")) {
            const err42 = { instancePath: instancePath + "/config/onError", schemaPath: "#/properties/config/properties/onError/enum", keyword: "enum", params: { allowedValues: schema48.properties.config.properties.onError.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
        }
        if (data13.interaction !== void 0) {
          let data17 = data13.interaction;
          if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
            for (const key3 in data17) {
              if (!(key3 === "conversation" || key3 === "knowledge" || key3 === "streaming")) {
                const err43 = { instancePath: instancePath + "/config/interaction", schemaPath: "#/definitions/interaction/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err43];
                } else {
                  vErrors.push(err43);
                }
                errors++;
              }
            }
            if (data17.conversation !== void 0) {
              let data18 = data17.conversation;
              if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
                for (const key4 in data18) {
                  if (!(key4 === "multiTurn" || key4 === "history" || key4 === "historyWindow")) {
                    const err44 = { instancePath: instancePath + "/config/interaction/conversation", schemaPath: "#/definitions/interaction/properties/conversation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err44];
                    } else {
                      vErrors.push(err44);
                    }
                    errors++;
                  }
                }
                if (data18.multiTurn !== void 0) {
                  if (typeof data18.multiTurn !== "boolean") {
                    const err45 = { instancePath: instancePath + "/config/interaction/conversation/multiTurn", schemaPath: "#/definitions/interaction/properties/conversation/properties/multiTurn/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                    if (vErrors === null) {
                      vErrors = [err45];
                    } else {
                      vErrors.push(err45);
                    }
                    errors++;
                  }
                }
                if (data18.history !== void 0) {
                  if (typeof data18.history !== "boolean") {
                    const err46 = { instancePath: instancePath + "/config/interaction/conversation/history", schemaPath: "#/definitions/interaction/properties/conversation/properties/history/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                    if (vErrors === null) {
                      vErrors = [err46];
                    } else {
                      vErrors.push(err46);
                    }
                    errors++;
                  }
                }
                if (data18.historyWindow !== void 0) {
                  let data21 = data18.historyWindow;
                  if (!(typeof data21 == "number" && (!(data21 % 1) && !isNaN(data21)) && isFinite(data21))) {
                    const err47 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err47];
                    } else {
                      vErrors.push(err47);
                    }
                    errors++;
                  }
                  if (typeof data21 == "number" && isFinite(data21)) {
                    if (data21 > 100 || isNaN(data21)) {
                      const err48 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/maximum", keyword: "maximum", params: { comparison: "<=", limit: 100 }, message: "must be <= 100" };
                      if (vErrors === null) {
                        vErrors = [err48];
                      } else {
                        vErrors.push(err48);
                      }
                      errors++;
                    }
                    if (data21 < 1 || isNaN(data21)) {
                      const err49 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                      if (vErrors === null) {
                        vErrors = [err49];
                      } else {
                        vErrors.push(err49);
                      }
                      errors++;
                    }
                  }
                }
              } else {
                const err50 = { instancePath: instancePath + "/config/interaction/conversation", schemaPath: "#/definitions/interaction/properties/conversation/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err50];
                } else {
                  vErrors.push(err50);
                }
                errors++;
              }
            }
            if (data17.knowledge !== void 0) {
              let data22 = data17.knowledge;
              if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
                if (data22.enabled === void 0) {
                  const err51 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/required", keyword: "required", params: { missingProperty: "enabled" }, message: "must have required property 'enabled'" };
                  if (vErrors === null) {
                    vErrors = [err51];
                  } else {
                    vErrors.push(err51);
                  }
                  errors++;
                }
                for (const key5 in data22) {
                  if (!(key5 === "enabled" || key5 === "scopes" || key5 === "topK" || key5 === "chunkSize" || key5 === "chunkOverlap")) {
                    const err52 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err52];
                    } else {
                      vErrors.push(err52);
                    }
                    errors++;
                  }
                }
                if (data22.enabled !== void 0) {
                  if (true !== data22.enabled) {
                    const err53 = { instancePath: instancePath + "/config/interaction/knowledge/enabled", schemaPath: "#/definitions/interaction/properties/knowledge/properties/enabled/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err53];
                    } else {
                      vErrors.push(err53);
                    }
                    errors++;
                  }
                }
                if (data22.scopes !== void 0) {
                  let data24 = data22.scopes;
                  if (Array.isArray(data24)) {
                    if (data24.length > 2) {
                      const err54 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/maxItems", keyword: "maxItems", params: { limit: 2 }, message: "must NOT have more than 2 items" };
                      if (vErrors === null) {
                        vErrors = [err54];
                      } else {
                        vErrors.push(err54);
                      }
                      errors++;
                    }
                    if (data24.length < 1) {
                      const err55 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                      if (vErrors === null) {
                        vErrors = [err55];
                      } else {
                        vErrors.push(err55);
                      }
                      errors++;
                    }
                    const len3 = data24.length;
                    for (let i5 = 0; i5 < len3; i5++) {
                      let data25 = data24[i5];
                      if (!(data25 === "app" || data25 === "session")) {
                        const err56 = { instancePath: instancePath + "/config/interaction/knowledge/scopes/" + i5, schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/items/enum", keyword: "enum", params: { allowedValues: schema54.properties.knowledge.properties.scopes.items.enum }, message: "must be equal to one of the allowed values" };
                        if (vErrors === null) {
                          vErrors = [err56];
                        } else {
                          vErrors.push(err56);
                        }
                        errors++;
                      }
                    }
                    let i6 = data24.length;
                    let j2;
                    if (i6 > 1) {
                      outer1: for (; i6--; ) {
                        for (j2 = i6; j2--; ) {
                          if (func0(data24[i6], data24[j2])) {
                            const err57 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/uniqueItems", keyword: "uniqueItems", params: { i: i6, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i6 + " are identical)" };
                            if (vErrors === null) {
                              vErrors = [err57];
                            } else {
                              vErrors.push(err57);
                            }
                            errors++;
                            break outer1;
                          }
                        }
                      }
                    }
                  } else {
                    const err58 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    if (vErrors === null) {
                      vErrors = [err58];
                    } else {
                      vErrors.push(err58);
                    }
                    errors++;
                  }
                }
                if (data22.topK !== void 0) {
                  let data26 = data22.topK;
                  if (!(typeof data26 == "number" && (!(data26 % 1) && !isNaN(data26)) && isFinite(data26))) {
                    const err59 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err59];
                    } else {
                      vErrors.push(err59);
                    }
                    errors++;
                  }
                  if (typeof data26 == "number" && isFinite(data26)) {
                    if (data26 > 20 || isNaN(data26)) {
                      const err60 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/maximum", keyword: "maximum", params: { comparison: "<=", limit: 20 }, message: "must be <= 20" };
                      if (vErrors === null) {
                        vErrors = [err60];
                      } else {
                        vErrors.push(err60);
                      }
                      errors++;
                    }
                    if (data26 < 1 || isNaN(data26)) {
                      const err61 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                      if (vErrors === null) {
                        vErrors = [err61];
                      } else {
                        vErrors.push(err61);
                      }
                      errors++;
                    }
                  }
                }
                if (data22.chunkSize !== void 0) {
                  let data27 = data22.chunkSize;
                  if (!(typeof data27 == "number" && (!(data27 % 1) && !isNaN(data27)) && isFinite(data27))) {
                    const err62 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err62];
                    } else {
                      vErrors.push(err62);
                    }
                    errors++;
                  }
                  if (typeof data27 == "number" && isFinite(data27)) {
                    if (data27 > 8e3 || isNaN(data27)) {
                      const err63 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8e3 }, message: "must be <= 8000" };
                      if (vErrors === null) {
                        vErrors = [err63];
                      } else {
                        vErrors.push(err63);
                      }
                      errors++;
                    }
                    if (data27 < 200 || isNaN(data27)) {
                      const err64 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/minimum", keyword: "minimum", params: { comparison: ">=", limit: 200 }, message: "must be >= 200" };
                      if (vErrors === null) {
                        vErrors = [err64];
                      } else {
                        vErrors.push(err64);
                      }
                      errors++;
                    }
                  }
                }
                if (data22.chunkOverlap !== void 0) {
                  let data28 = data22.chunkOverlap;
                  if (!(typeof data28 == "number" && (!(data28 % 1) && !isNaN(data28)) && isFinite(data28))) {
                    const err65 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err65];
                    } else {
                      vErrors.push(err65);
                    }
                    errors++;
                  }
                  if (typeof data28 == "number" && isFinite(data28)) {
                    if (data28 > 2e3 || isNaN(data28)) {
                      const err66 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/maximum", keyword: "maximum", params: { comparison: "<=", limit: 2e3 }, message: "must be <= 2000" };
                      if (vErrors === null) {
                        vErrors = [err66];
                      } else {
                        vErrors.push(err66);
                      }
                      errors++;
                    }
                    if (data28 < 0 || isNaN(data28)) {
                      const err67 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                      if (vErrors === null) {
                        vErrors = [err67];
                      } else {
                        vErrors.push(err67);
                      }
                      errors++;
                    }
                  }
                }
              } else {
                const err68 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err68];
                } else {
                  vErrors.push(err68);
                }
                errors++;
              }
            }
            if (data17.streaming !== void 0) {
              let data29 = data17.streaming;
              if (data29 && typeof data29 == "object" && !Array.isArray(data29)) {
                if (data29.defaultMode === void 0) {
                  const err69 = { instancePath: instancePath + "/config/interaction/streaming", schemaPath: "#/definitions/interaction/properties/streaming/required", keyword: "required", params: { missingProperty: "defaultMode" }, message: "must have required property 'defaultMode'" };
                  if (vErrors === null) {
                    vErrors = [err69];
                  } else {
                    vErrors.push(err69);
                  }
                  errors++;
                }
                for (const key6 in data29) {
                  if (!(key6 === "defaultMode")) {
                    const err70 = { instancePath: instancePath + "/config/interaction/streaming", schemaPath: "#/definitions/interaction/properties/streaming/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err70];
                    } else {
                      vErrors.push(err70);
                    }
                    errors++;
                  }
                }
                if (data29.defaultMode !== void 0) {
                  let data30 = data29.defaultMode;
                  if (!(data30 === "text" || data30 === "events")) {
                    const err71 = { instancePath: instancePath + "/config/interaction/streaming/defaultMode", schemaPath: "#/definitions/interaction/properties/streaming/properties/defaultMode/enum", keyword: "enum", params: { allowedValues: schema54.properties.streaming.properties.defaultMode.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err71];
                    } else {
                      vErrors.push(err71);
                    }
                    errors++;
                  }
                }
              } else {
                const err72 = { instancePath: instancePath + "/config/interaction/streaming", schemaPath: "#/definitions/interaction/properties/streaming/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err72];
                } else {
                  vErrors.push(err72);
                }
                errors++;
              }
            }
          } else {
            const err73 = { instancePath: instancePath + "/config/interaction", schemaPath: "#/definitions/interaction/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err73];
            } else {
              vErrors.push(err73);
            }
            errors++;
          }
        }
        if (data13.background !== void 0) {
          if (!validate32(data13.background, { instancePath: instancePath + "/config/background", parentData: data13, parentDataProperty: "background", rootData })) {
            vErrors = vErrors === null ? validate32.errors : vErrors.concat(validate32.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err74 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err74];
        } else {
          vErrors.push(err74);
        }
        errors++;
      }
    }
  } else {
    const err75 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err75];
    } else {
      vErrors.push(err75);
    }
    errors++;
  }
  validate31.errors = vErrors;
  return errors === 0;
}
var flowBeta1 = validate41;
var schema62 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/beta-one/flow.schema.json", "title": "AgComm .ai flow Beta 1", "type": "object", "required": ["entry", "nodes", "edges"], "properties": { "entry": { "$ref": "#/definitions/id" }, "nodes": { "type": "array", "minItems": 1, "maxItems": 2e3, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } }, "edges": { "type": "array", "maxItems": 8e3, "items": { "type": "object", "required": ["from", "to"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "from": { "$ref": "#/definitions/id" }, "to": { "$ref": "#/definitions/id" }, "label": { "type": "string", "maxLength": 200 }, "condition": { "type": "string", "maxLength": 2e3 } } } }, "variables": { "type": "object", "maxProperties": 512 }, "visualizations": { "type": "array", "maxItems": 32, "uniqueItems": true, "items": { "type": "string", "maxLength": 64 } }, "config": { "type": "object", "additionalProperties": false, "properties": { "timeoutMs": { "type": "integer", "minimum": 1, "maximum": 6e5 }, "maxConcurrency": { "type": "integer", "minimum": 1, "maximum": 32 }, "onError": { "enum": ["stop", "continue"] }, "interaction": { "$ref": "#/definitions/interaction" }, "background": { "$ref": "#/definitions/background" }, "hookIds": { "type": "array", "maxItems": 16, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } } } } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, "jsonValue": {}, "variables": { "type": "object", "maxProperties": 512, "additionalProperties": { "$ref": "#/definitions/jsonValue" } }, "heartbeat": { "type": "object", "required": ["id", "everyMs", "input", "variables", "runOnStart"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "everyMs": { "type": "integer", "minimum": 6e4, "maximum": 864e5 }, "input": { "type": "string", "maxLength": 65536 }, "variables": { "$ref": "#/definitions/variables" }, "runOnStart": { "type": "boolean" } } }, "cronTrigger": { "type": "object", "required": ["id", "expression", "timezone", "input", "variables", "misfireGraceMs"], "additionalProperties": false, "properties": { "id": { "$ref": "#/definitions/id" }, "expression": { "type": "string", "minLength": 9, "maxLength": 120 }, "timezone": { "type": "string", "minLength": 1, "maxLength": 80 }, "input": { "type": "string", "maxLength": 65536 }, "variables": { "$ref": "#/definitions/variables" }, "misfireGraceMs": { "type": "integer", "minimum": 0, "maximum": 864e5 } } }, "background": { "type": "object", "minProperties": 1, "additionalProperties": false, "properties": { "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 }, "heartbeat": { "$ref": "#/definitions/heartbeat" }, "cron": { "type": "array", "maxItems": 64, "items": { "$ref": "#/definitions/cronTrigger" } } } }, "interaction": { "type": "object", "additionalProperties": false, "properties": { "conversation": { "type": "object", "additionalProperties": false, "properties": { "multiTurn": { "type": "boolean" }, "history": { "type": "boolean" }, "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 } } }, "knowledge": { "type": "object", "required": ["enabled"], "additionalProperties": false, "properties": { "enabled": { "const": true }, "scopes": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["app", "session"] } }, "topK": { "type": "integer", "minimum": 1, "maximum": 20 }, "chunkSize": { "type": "integer", "minimum": 200, "maximum": 8e3 }, "chunkOverlap": { "type": "integer", "minimum": 0, "maximum": 2e3 } } }, "streaming": { "type": "object", "required": ["defaultMode"], "additionalProperties": false, "properties": { "defaultMode": { "enum": ["text", "events"] } } } } } } };
var schema68 = { "type": "object", "additionalProperties": false, "properties": { "conversation": { "type": "object", "additionalProperties": false, "properties": { "multiTurn": { "type": "boolean" }, "history": { "type": "boolean" }, "historyWindow": { "type": "integer", "minimum": 1, "maximum": 100 } } }, "knowledge": { "type": "object", "required": ["enabled"], "additionalProperties": false, "properties": { "enabled": { "const": true }, "scopes": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["app", "session"] } }, "topK": { "type": "integer", "minimum": 1, "maximum": 20 }, "chunkSize": { "type": "integer", "minimum": 200, "maximum": 8e3 }, "chunkOverlap": { "type": "integer", "minimum": 0, "maximum": 2e3 } } }, "streaming": { "type": "object", "required": ["defaultMode"], "additionalProperties": false, "properties": { "defaultMode": { "enum": ["text", "events"] } } } } };
function validate44(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length > 512) {
      const err0 = { instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 512 }, message: "must NOT have more than 512 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate44.errors = vErrors;
  return errors === 0;
}
function validate43(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.everyMs === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "everyMs" }, message: "must have required property 'everyMs'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.input === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.variables === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "variables" }, message: "must have required property 'variables'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.runOnStart === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runOnStart" }, message: "must have required property 'runOnStart'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "everyMs" || key0 === "input" || key0 === "variables" || key0 === "runOnStart")) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err6 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.everyMs !== void 0) {
      let data1 = data.everyMs;
      if (!(typeof data1 == "number" && (!(data1 % 1) && !isNaN(data1)) && isFinite(data1))) {
        const err8 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      if (typeof data1 == "number" && isFinite(data1)) {
        if (data1 > 864e5 || isNaN(data1)) {
          const err9 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 864e5 }, message: "must be <= 86400000" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (data1 < 6e4 || isNaN(data1)) {
          const err10 = { instancePath: instancePath + "/everyMs", schemaPath: "#/properties/everyMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 6e4 }, message: "must be >= 60000" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      }
    }
    if (data.input !== void 0) {
      let data2 = data.input;
      if (typeof data2 === "string") {
        if (func3(data2) > 65536) {
          const err11 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/maxLength", keyword: "maxLength", params: { limit: 65536 }, message: "must NOT have more than 65536 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      if (!validate44(data.variables, { instancePath: instancePath + "/variables", parentData: data, parentDataProperty: "variables", rootData })) {
        vErrors = vErrors === null ? validate44.errors : vErrors.concat(validate44.errors);
        errors = vErrors.length;
      }
    }
    if (data.runOnStart !== void 0) {
      if (typeof data.runOnStart !== "boolean") {
        const err13 = { instancePath: instancePath + "/runOnStart", schemaPath: "#/properties/runOnStart/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  validate43.errors = vErrors;
  return errors === 0;
}
function validate47(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.expression === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "expression" }, message: "must have required property 'expression'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.timezone === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "timezone" }, message: "must have required property 'timezone'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.input === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.variables === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "variables" }, message: "must have required property 'variables'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.misfireGraceMs === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "misfireGraceMs" }, message: "must have required property 'misfireGraceMs'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "expression" || key0 === "timezone" || key0 === "input" || key0 === "variables" || key0 === "misfireGraceMs")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.expression !== void 0) {
      let data1 = data.expression;
      if (typeof data1 === "string") {
        if (func3(data1) > 120) {
          const err9 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (func3(data1) < 9) {
          const err10 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/minLength", keyword: "minLength", params: { limit: 9 }, message: "must NOT have fewer than 9 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/expression", schemaPath: "#/properties/expression/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.timezone !== void 0) {
      let data2 = data.timezone;
      if (typeof data2 === "string") {
        if (func3(data2) > 80) {
          const err12 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/maxLength", keyword: "maxLength", params: { limit: 80 }, message: "must NOT have more than 80 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (func3(data2) < 1) {
          const err13 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/timezone", schemaPath: "#/properties/timezone/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.input !== void 0) {
      let data3 = data.input;
      if (typeof data3 === "string") {
        if (func3(data3) > 65536) {
          const err15 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/maxLength", keyword: "maxLength", params: { limit: 65536 }, message: "must NOT have more than 65536 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/input", schemaPath: "#/properties/input/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      if (!validate44(data.variables, { instancePath: instancePath + "/variables", parentData: data, parentDataProperty: "variables", rootData })) {
        vErrors = vErrors === null ? validate44.errors : vErrors.concat(validate44.errors);
        errors = vErrors.length;
      }
    }
    if (data.misfireGraceMs !== void 0) {
      let data5 = data.misfireGraceMs;
      if (!(typeof data5 == "number" && (!(data5 % 1) && !isNaN(data5)) && isFinite(data5))) {
        const err17 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (typeof data5 == "number" && isFinite(data5)) {
        if (data5 > 864e5 || isNaN(data5)) {
          const err18 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 864e5 }, message: "must be <= 86400000" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        if (data5 < 0 || isNaN(data5)) {
          const err19 = { instancePath: instancePath + "/misfireGraceMs", schemaPath: "#/properties/misfireGraceMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      }
    }
  } else {
    const err20 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err20];
    } else {
      vErrors.push(err20);
    }
    errors++;
  }
  validate47.errors = vErrors;
  return errors === 0;
}
function validate42(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length < 1) {
      const err0 = { instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "historyWindow" || key0 === "heartbeat" || key0 === "cron")) {
        const err1 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    if (data.historyWindow !== void 0) {
      let data0 = data.historyWindow;
      if (!(typeof data0 == "number" && (!(data0 % 1) && !isNaN(data0)) && isFinite(data0))) {
        const err2 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (typeof data0 == "number" && isFinite(data0)) {
        if (data0 > 100 || isNaN(data0)) {
          const err3 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/maximum", keyword: "maximum", params: { comparison: "<=", limit: 100 }, message: "must be <= 100" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        if (data0 < 1 || isNaN(data0)) {
          const err4 = { instancePath: instancePath + "/historyWindow", schemaPath: "#/properties/historyWindow/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
    }
    if (data.heartbeat !== void 0) {
      if (!validate43(data.heartbeat, { instancePath: instancePath + "/heartbeat", parentData: data, parentDataProperty: "heartbeat", rootData })) {
        vErrors = vErrors === null ? validate43.errors : vErrors.concat(validate43.errors);
        errors = vErrors.length;
      }
    }
    if (data.cron !== void 0) {
      let data2 = data.cron;
      if (Array.isArray(data2)) {
        if (data2.length > 64) {
          const err5 = { instancePath: instancePath + "/cron", schemaPath: "#/properties/cron/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        const len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate47(data2[i0], { instancePath: instancePath + "/cron/" + i0, parentData: data2, parentDataProperty: i0, rootData })) {
            vErrors = vErrors === null ? validate47.errors : vErrors.concat(validate47.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err6 = { instancePath: instancePath + "/cron", schemaPath: "#/properties/cron/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate42.errors = vErrors;
  return errors === 0;
}
function validate41(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.entry === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.nodes === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "nodes" }, message: "must have required property 'nodes'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.edges === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edges" }, message: "must have required property 'edges'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "entry" || key0 === "nodes" || key0 === "edges" || key0 === "variables" || key0 === "visualizations" || key0 === "config")) {
        const err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.entry !== void 0) {
      let data0 = data.entry;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err4 = { instancePath: instancePath + "/entry", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/entry", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.nodes !== void 0) {
      let data1 = data.nodes;
      if (Array.isArray(data1)) {
        if (data1.length > 2e3) {
          const err6 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/maxItems", keyword: "maxItems", params: { limit: 2e3 }, message: "must NOT have more than 2000 items" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data1.length < 1) {
          const err7 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (typeof data2 === "string") {
            if (!pattern0.test(data2)) {
              const err8 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        let i1 = data1.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data1[i1], data1[j0])) {
                const err10 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err11 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.edges !== void 0) {
      let data3 = data.edges;
      if (Array.isArray(data3)) {
        if (data3.length > 8e3) {
          const err12 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/maxItems", keyword: "maxItems", params: { limit: 8e3 }, message: "must NOT have more than 8000 items" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        const len1 = data3.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data4 = data3[i2];
          if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
            if (data4.from === void 0) {
              const err13 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
            if (data4.to === void 0) {
              const err14 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
            for (const key1 in data4) {
              if (!(key1 === "id" || key1 === "from" || key1 === "to" || key1 === "label" || key1 === "condition")) {
                const err15 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
            }
            if (data4.id !== void 0) {
              let data5 = data4.id;
              if (typeof data5 === "string") {
                if (!pattern0.test(data5)) {
                  const err16 = { instancePath: instancePath + "/edges/" + i2 + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err16];
                  } else {
                    vErrors.push(err16);
                  }
                  errors++;
                }
              } else {
                const err17 = { instancePath: instancePath + "/edges/" + i2 + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
            if (data4.from !== void 0) {
              let data6 = data4.from;
              if (typeof data6 === "string") {
                if (!pattern0.test(data6)) {
                  const err18 = { instancePath: instancePath + "/edges/" + i2 + "/from", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err18];
                  } else {
                    vErrors.push(err18);
                  }
                  errors++;
                }
              } else {
                const err19 = { instancePath: instancePath + "/edges/" + i2 + "/from", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err19];
                } else {
                  vErrors.push(err19);
                }
                errors++;
              }
            }
            if (data4.to !== void 0) {
              let data7 = data4.to;
              if (typeof data7 === "string") {
                if (!pattern0.test(data7)) {
                  const err20 = { instancePath: instancePath + "/edges/" + i2 + "/to", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
              } else {
                const err21 = { instancePath: instancePath + "/edges/" + i2 + "/to", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
            if (data4.label !== void 0) {
              let data8 = data4.label;
              if (typeof data8 === "string") {
                if (func3(data8) > 200) {
                  const err22 = { instancePath: instancePath + "/edges/" + i2 + "/label", schemaPath: "#/properties/edges/items/properties/label/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
                  if (vErrors === null) {
                    vErrors = [err22];
                  } else {
                    vErrors.push(err22);
                  }
                  errors++;
                }
              } else {
                const err23 = { instancePath: instancePath + "/edges/" + i2 + "/label", schemaPath: "#/properties/edges/items/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
            }
            if (data4.condition !== void 0) {
              let data9 = data4.condition;
              if (typeof data9 === "string") {
                if (func3(data9) > 2e3) {
                  const err24 = { instancePath: instancePath + "/edges/" + i2 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
                  if (vErrors === null) {
                    vErrors = [err24];
                  } else {
                    vErrors.push(err24);
                  }
                  errors++;
                }
              } else {
                const err25 = { instancePath: instancePath + "/edges/" + i2 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
          } else {
            const err26 = { instancePath: instancePath + "/edges/" + i2, schemaPath: "#/properties/edges/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      let data10 = data.variables;
      if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
        if (Object.keys(data10).length > 512) {
          const err28 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/maxProperties", keyword: "maxProperties", params: { limit: 512 }, message: "must NOT have more than 512 properties" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
      } else {
        const err29 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.visualizations !== void 0) {
      let data11 = data.visualizations;
      if (Array.isArray(data11)) {
        if (data11.length > 32) {
          const err30 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        const len2 = data11.length;
        for (let i3 = 0; i3 < len2; i3++) {
          let data12 = data11[i3];
          if (typeof data12 === "string") {
            if (func3(data12) > 64) {
              const err31 = { instancePath: instancePath + "/visualizations/" + i3, schemaPath: "#/properties/visualizations/items/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
          } else {
            const err32 = { instancePath: instancePath + "/visualizations/" + i3, schemaPath: "#/properties/visualizations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        let i4 = data11.length;
        let j1;
        if (i4 > 1) {
          const indices0 = {};
          for (; i4--; ) {
            let item0 = data11[i4];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j1 = indices0[item0];
              const err33 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i4 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
              break;
            }
            indices0[item0] = i4;
          }
        }
      } else {
        const err34 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
    if (data.config !== void 0) {
      let data13 = data.config;
      if (data13 && typeof data13 == "object" && !Array.isArray(data13)) {
        for (const key2 in data13) {
          if (!(key2 === "timeoutMs" || key2 === "maxConcurrency" || key2 === "onError" || key2 === "interaction" || key2 === "background" || key2 === "hookIds")) {
            const err35 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
        if (data13.timeoutMs !== void 0) {
          let data14 = data13.timeoutMs;
          if (!(typeof data14 == "number" && (!(data14 % 1) && !isNaN(data14)) && isFinite(data14))) {
            const err36 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err36];
            } else {
              vErrors.push(err36);
            }
            errors++;
          }
          if (typeof data14 == "number" && isFinite(data14)) {
            if (data14 > 6e5 || isNaN(data14)) {
              const err37 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e5 }, message: "must be <= 600000" };
              if (vErrors === null) {
                vErrors = [err37];
              } else {
                vErrors.push(err37);
              }
              errors++;
            }
            if (data14 < 1 || isNaN(data14)) {
              const err38 = { instancePath: instancePath + "/config/timeoutMs", schemaPath: "#/properties/config/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err38];
              } else {
                vErrors.push(err38);
              }
              errors++;
            }
          }
        }
        if (data13.maxConcurrency !== void 0) {
          let data15 = data13.maxConcurrency;
          if (!(typeof data15 == "number" && (!(data15 % 1) && !isNaN(data15)) && isFinite(data15))) {
            const err39 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
          if (typeof data15 == "number" && isFinite(data15)) {
            if (data15 > 32 || isNaN(data15)) {
              const err40 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/maximum", keyword: "maximum", params: { comparison: "<=", limit: 32 }, message: "must be <= 32" };
              if (vErrors === null) {
                vErrors = [err40];
              } else {
                vErrors.push(err40);
              }
              errors++;
            }
            if (data15 < 1 || isNaN(data15)) {
              const err41 = { instancePath: instancePath + "/config/maxConcurrency", schemaPath: "#/properties/config/properties/maxConcurrency/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err41];
              } else {
                vErrors.push(err41);
              }
              errors++;
            }
          }
        }
        if (data13.onError !== void 0) {
          let data16 = data13.onError;
          if (!(data16 === "stop" || data16 === "continue")) {
            const err42 = { instancePath: instancePath + "/config/onError", schemaPath: "#/properties/config/properties/onError/enum", keyword: "enum", params: { allowedValues: schema62.properties.config.properties.onError.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
        }
        if (data13.interaction !== void 0) {
          let data17 = data13.interaction;
          if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
            for (const key3 in data17) {
              if (!(key3 === "conversation" || key3 === "knowledge" || key3 === "streaming")) {
                const err43 = { instancePath: instancePath + "/config/interaction", schemaPath: "#/definitions/interaction/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err43];
                } else {
                  vErrors.push(err43);
                }
                errors++;
              }
            }
            if (data17.conversation !== void 0) {
              let data18 = data17.conversation;
              if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
                for (const key4 in data18) {
                  if (!(key4 === "multiTurn" || key4 === "history" || key4 === "historyWindow")) {
                    const err44 = { instancePath: instancePath + "/config/interaction/conversation", schemaPath: "#/definitions/interaction/properties/conversation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err44];
                    } else {
                      vErrors.push(err44);
                    }
                    errors++;
                  }
                }
                if (data18.multiTurn !== void 0) {
                  if (typeof data18.multiTurn !== "boolean") {
                    const err45 = { instancePath: instancePath + "/config/interaction/conversation/multiTurn", schemaPath: "#/definitions/interaction/properties/conversation/properties/multiTurn/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                    if (vErrors === null) {
                      vErrors = [err45];
                    } else {
                      vErrors.push(err45);
                    }
                    errors++;
                  }
                }
                if (data18.history !== void 0) {
                  if (typeof data18.history !== "boolean") {
                    const err46 = { instancePath: instancePath + "/config/interaction/conversation/history", schemaPath: "#/definitions/interaction/properties/conversation/properties/history/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                    if (vErrors === null) {
                      vErrors = [err46];
                    } else {
                      vErrors.push(err46);
                    }
                    errors++;
                  }
                }
                if (data18.historyWindow !== void 0) {
                  let data21 = data18.historyWindow;
                  if (!(typeof data21 == "number" && (!(data21 % 1) && !isNaN(data21)) && isFinite(data21))) {
                    const err47 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err47];
                    } else {
                      vErrors.push(err47);
                    }
                    errors++;
                  }
                  if (typeof data21 == "number" && isFinite(data21)) {
                    if (data21 > 100 || isNaN(data21)) {
                      const err48 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/maximum", keyword: "maximum", params: { comparison: "<=", limit: 100 }, message: "must be <= 100" };
                      if (vErrors === null) {
                        vErrors = [err48];
                      } else {
                        vErrors.push(err48);
                      }
                      errors++;
                    }
                    if (data21 < 1 || isNaN(data21)) {
                      const err49 = { instancePath: instancePath + "/config/interaction/conversation/historyWindow", schemaPath: "#/definitions/interaction/properties/conversation/properties/historyWindow/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                      if (vErrors === null) {
                        vErrors = [err49];
                      } else {
                        vErrors.push(err49);
                      }
                      errors++;
                    }
                  }
                }
              } else {
                const err50 = { instancePath: instancePath + "/config/interaction/conversation", schemaPath: "#/definitions/interaction/properties/conversation/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err50];
                } else {
                  vErrors.push(err50);
                }
                errors++;
              }
            }
            if (data17.knowledge !== void 0) {
              let data22 = data17.knowledge;
              if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
                if (data22.enabled === void 0) {
                  const err51 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/required", keyword: "required", params: { missingProperty: "enabled" }, message: "must have required property 'enabled'" };
                  if (vErrors === null) {
                    vErrors = [err51];
                  } else {
                    vErrors.push(err51);
                  }
                  errors++;
                }
                for (const key5 in data22) {
                  if (!(key5 === "enabled" || key5 === "scopes" || key5 === "topK" || key5 === "chunkSize" || key5 === "chunkOverlap")) {
                    const err52 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err52];
                    } else {
                      vErrors.push(err52);
                    }
                    errors++;
                  }
                }
                if (data22.enabled !== void 0) {
                  if (true !== data22.enabled) {
                    const err53 = { instancePath: instancePath + "/config/interaction/knowledge/enabled", schemaPath: "#/definitions/interaction/properties/knowledge/properties/enabled/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err53];
                    } else {
                      vErrors.push(err53);
                    }
                    errors++;
                  }
                }
                if (data22.scopes !== void 0) {
                  let data24 = data22.scopes;
                  if (Array.isArray(data24)) {
                    if (data24.length > 2) {
                      const err54 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/maxItems", keyword: "maxItems", params: { limit: 2 }, message: "must NOT have more than 2 items" };
                      if (vErrors === null) {
                        vErrors = [err54];
                      } else {
                        vErrors.push(err54);
                      }
                      errors++;
                    }
                    if (data24.length < 1) {
                      const err55 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                      if (vErrors === null) {
                        vErrors = [err55];
                      } else {
                        vErrors.push(err55);
                      }
                      errors++;
                    }
                    const len3 = data24.length;
                    for (let i5 = 0; i5 < len3; i5++) {
                      let data25 = data24[i5];
                      if (!(data25 === "app" || data25 === "session")) {
                        const err56 = { instancePath: instancePath + "/config/interaction/knowledge/scopes/" + i5, schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/items/enum", keyword: "enum", params: { allowedValues: schema68.properties.knowledge.properties.scopes.items.enum }, message: "must be equal to one of the allowed values" };
                        if (vErrors === null) {
                          vErrors = [err56];
                        } else {
                          vErrors.push(err56);
                        }
                        errors++;
                      }
                    }
                    let i6 = data24.length;
                    let j2;
                    if (i6 > 1) {
                      outer1: for (; i6--; ) {
                        for (j2 = i6; j2--; ) {
                          if (func0(data24[i6], data24[j2])) {
                            const err57 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/uniqueItems", keyword: "uniqueItems", params: { i: i6, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i6 + " are identical)" };
                            if (vErrors === null) {
                              vErrors = [err57];
                            } else {
                              vErrors.push(err57);
                            }
                            errors++;
                            break outer1;
                          }
                        }
                      }
                    }
                  } else {
                    const err58 = { instancePath: instancePath + "/config/interaction/knowledge/scopes", schemaPath: "#/definitions/interaction/properties/knowledge/properties/scopes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    if (vErrors === null) {
                      vErrors = [err58];
                    } else {
                      vErrors.push(err58);
                    }
                    errors++;
                  }
                }
                if (data22.topK !== void 0) {
                  let data26 = data22.topK;
                  if (!(typeof data26 == "number" && (!(data26 % 1) && !isNaN(data26)) && isFinite(data26))) {
                    const err59 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err59];
                    } else {
                      vErrors.push(err59);
                    }
                    errors++;
                  }
                  if (typeof data26 == "number" && isFinite(data26)) {
                    if (data26 > 20 || isNaN(data26)) {
                      const err60 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/maximum", keyword: "maximum", params: { comparison: "<=", limit: 20 }, message: "must be <= 20" };
                      if (vErrors === null) {
                        vErrors = [err60];
                      } else {
                        vErrors.push(err60);
                      }
                      errors++;
                    }
                    if (data26 < 1 || isNaN(data26)) {
                      const err61 = { instancePath: instancePath + "/config/interaction/knowledge/topK", schemaPath: "#/definitions/interaction/properties/knowledge/properties/topK/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                      if (vErrors === null) {
                        vErrors = [err61];
                      } else {
                        vErrors.push(err61);
                      }
                      errors++;
                    }
                  }
                }
                if (data22.chunkSize !== void 0) {
                  let data27 = data22.chunkSize;
                  if (!(typeof data27 == "number" && (!(data27 % 1) && !isNaN(data27)) && isFinite(data27))) {
                    const err62 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err62];
                    } else {
                      vErrors.push(err62);
                    }
                    errors++;
                  }
                  if (typeof data27 == "number" && isFinite(data27)) {
                    if (data27 > 8e3 || isNaN(data27)) {
                      const err63 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8e3 }, message: "must be <= 8000" };
                      if (vErrors === null) {
                        vErrors = [err63];
                      } else {
                        vErrors.push(err63);
                      }
                      errors++;
                    }
                    if (data27 < 200 || isNaN(data27)) {
                      const err64 = { instancePath: instancePath + "/config/interaction/knowledge/chunkSize", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkSize/minimum", keyword: "minimum", params: { comparison: ">=", limit: 200 }, message: "must be >= 200" };
                      if (vErrors === null) {
                        vErrors = [err64];
                      } else {
                        vErrors.push(err64);
                      }
                      errors++;
                    }
                  }
                }
                if (data22.chunkOverlap !== void 0) {
                  let data28 = data22.chunkOverlap;
                  if (!(typeof data28 == "number" && (!(data28 % 1) && !isNaN(data28)) && isFinite(data28))) {
                    const err65 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err65];
                    } else {
                      vErrors.push(err65);
                    }
                    errors++;
                  }
                  if (typeof data28 == "number" && isFinite(data28)) {
                    if (data28 > 2e3 || isNaN(data28)) {
                      const err66 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/maximum", keyword: "maximum", params: { comparison: "<=", limit: 2e3 }, message: "must be <= 2000" };
                      if (vErrors === null) {
                        vErrors = [err66];
                      } else {
                        vErrors.push(err66);
                      }
                      errors++;
                    }
                    if (data28 < 0 || isNaN(data28)) {
                      const err67 = { instancePath: instancePath + "/config/interaction/knowledge/chunkOverlap", schemaPath: "#/definitions/interaction/properties/knowledge/properties/chunkOverlap/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                      if (vErrors === null) {
                        vErrors = [err67];
                      } else {
                        vErrors.push(err67);
                      }
                      errors++;
                    }
                  }
                }
              } else {
                const err68 = { instancePath: instancePath + "/config/interaction/knowledge", schemaPath: "#/definitions/interaction/properties/knowledge/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err68];
                } else {
                  vErrors.push(err68);
                }
                errors++;
              }
            }
            if (data17.streaming !== void 0) {
              let data29 = data17.streaming;
              if (data29 && typeof data29 == "object" && !Array.isArray(data29)) {
                if (data29.defaultMode === void 0) {
                  const err69 = { instancePath: instancePath + "/config/interaction/streaming", schemaPath: "#/definitions/interaction/properties/streaming/required", keyword: "required", params: { missingProperty: "defaultMode" }, message: "must have required property 'defaultMode'" };
                  if (vErrors === null) {
                    vErrors = [err69];
                  } else {
                    vErrors.push(err69);
                  }
                  errors++;
                }
                for (const key6 in data29) {
                  if (!(key6 === "defaultMode")) {
                    const err70 = { instancePath: instancePath + "/config/interaction/streaming", schemaPath: "#/definitions/interaction/properties/streaming/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err70];
                    } else {
                      vErrors.push(err70);
                    }
                    errors++;
                  }
                }
                if (data29.defaultMode !== void 0) {
                  let data30 = data29.defaultMode;
                  if (!(data30 === "text" || data30 === "events")) {
                    const err71 = { instancePath: instancePath + "/config/interaction/streaming/defaultMode", schemaPath: "#/definitions/interaction/properties/streaming/properties/defaultMode/enum", keyword: "enum", params: { allowedValues: schema68.properties.streaming.properties.defaultMode.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err71];
                    } else {
                      vErrors.push(err71);
                    }
                    errors++;
                  }
                }
              } else {
                const err72 = { instancePath: instancePath + "/config/interaction/streaming", schemaPath: "#/definitions/interaction/properties/streaming/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err72];
                } else {
                  vErrors.push(err72);
                }
                errors++;
              }
            }
          } else {
            const err73 = { instancePath: instancePath + "/config/interaction", schemaPath: "#/definitions/interaction/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err73];
            } else {
              vErrors.push(err73);
            }
            errors++;
          }
        }
        if (data13.background !== void 0) {
          if (!validate42(data13.background, { instancePath: instancePath + "/config/background", parentData: data13, parentDataProperty: "background", rootData })) {
            vErrors = vErrors === null ? validate42.errors : vErrors.concat(validate42.errors);
            errors = vErrors.length;
          }
        }
        if (data13.hookIds !== void 0) {
          let data32 = data13.hookIds;
          if (Array.isArray(data32)) {
            if (data32.length > 16) {
              const err74 = { instancePath: instancePath + "/config/hookIds", schemaPath: "#/properties/config/properties/hookIds/maxItems", keyword: "maxItems", params: { limit: 16 }, message: "must NOT have more than 16 items" };
              if (vErrors === null) {
                vErrors = [err74];
              } else {
                vErrors.push(err74);
              }
              errors++;
            }
            const len4 = data32.length;
            for (let i7 = 0; i7 < len4; i7++) {
              let data33 = data32[i7];
              if (typeof data33 === "string") {
                if (!pattern0.test(data33)) {
                  const err75 = { instancePath: instancePath + "/config/hookIds/" + i7, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err75];
                  } else {
                    vErrors.push(err75);
                  }
                  errors++;
                }
              } else {
                const err76 = { instancePath: instancePath + "/config/hookIds/" + i7, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err76];
                } else {
                  vErrors.push(err76);
                }
                errors++;
              }
            }
            let i8 = data32.length;
            let j3;
            if (i8 > 1) {
              outer2: for (; i8--; ) {
                for (j3 = i8; j3--; ) {
                  if (func0(data32[i8], data32[j3])) {
                    const err77 = { instancePath: instancePath + "/config/hookIds", schemaPath: "#/properties/config/properties/hookIds/uniqueItems", keyword: "uniqueItems", params: { i: i8, j: j3 }, message: "must NOT have duplicate items (items ## " + j3 + " and " + i8 + " are identical)" };
                    if (vErrors === null) {
                      vErrors = [err77];
                    } else {
                      vErrors.push(err77);
                    }
                    errors++;
                    break outer2;
                  }
                }
              }
            }
          } else {
            const err78 = { instancePath: instancePath + "/config/hookIds", schemaPath: "#/properties/config/properties/hookIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err78];
            } else {
              vErrors.push(err78);
            }
            errors++;
          }
        }
      } else {
        const err79 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err79];
        } else {
          vErrors.push(err79);
        }
        errors++;
      }
    }
  } else {
    const err80 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err80];
    } else {
      vErrors.push(err80);
    }
    errors++;
  }
  validate41.errors = vErrors;
  return errors === 0;
}
var node = validate51;
var schema77 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v2/node.schema.json", "title": "AgComm .ai node v2", "type": "object", "required": ["id", "title", "type", "position", "output_var"], "properties": { "id": { "$ref": "#/definitions/id" }, "title": { "type": "string", "minLength": 1, "maxLength": 120 }, "type": { "enum": ["START", "INPUT", "SKILL", "WORKSPACE", "HTTP", "CONDITION", "OUTPUT"] }, "skill_name": { "$ref": "#/definitions/id" }, "workspace": { "type": "object", "required": ["agentSkillId", "skillIds", "maxIterations"], "properties": { "agentSkillId": { "$ref": "#/definitions/id" }, "skillIds": { "type": "array", "maxItems": 256, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } }, "maxIterations": { "type": "integer", "minimum": 1, "maximum": 10 }, "agentName": { "type": "string", "maxLength": 120 }, "agentPrompt": { "type": "string", "maxLength": 1048576 } }, "additionalProperties": false }, "config": { "type": "object" }, "output_var": { "type": "string", "maxLength": 64, "pattern": "^$|^[A-Za-z_][A-Za-z0-9_]{0,63}$" }, "position": { "type": "object", "required": ["x", "y"], "properties": { "x": { "type": "number", "minimum": -1e6, "maximum": 1e6 }, "y": { "type": "number", "minimum": -1e6, "maximum": 1e6 } }, "additionalProperties": false }, "icon": { "type": "string", "maxLength": 16 }, "tone": { "type": "string", "maxLength": 32 }, "note": { "type": "string", "maxLength": 1e3 }, "timeoutMs": { "type": "integer", "minimum": 1, "maximum": 6e5 }, "retry": { "type": "object", "properties": { "maxAttempts": { "type": "integer", "minimum": 1, "maximum": 10 }, "delayMs": { "type": "integer", "minimum": 0, "maximum": 6e4 }, "backoff": { "enum": ["fixed", "exponential"] } }, "additionalProperties": false }, "onError": { "enum": ["stop", "continue"] } }, "additionalProperties": false, "allOf": [{ "if": { "properties": { "type": { "const": "SKILL" } } }, "then": { "required": ["skill_name"] } }, { "if": { "properties": { "type": { "const": "WORKSPACE" } } }, "then": { "required": ["workspace"] } }], "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
var pattern39 = new RegExp("^$|^[A-Za-z_][A-Za-z0-9_]{0,63}$", "u");
function validate51(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.type !== void 0) {
      if ("SKILL" !== data.type) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.skill_name === void 0) {
        const err1 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "skill_name" }, message: "must have required property 'skill_name'" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err2 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err2];
    } else {
      vErrors.push(err2);
    }
    errors++;
  }
  const _errs7 = errors;
  let valid3 = true;
  const _errs8 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.type !== void 0) {
      if ("WORKSPACE" !== data.type) {
        const err3 = {};
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
  }
  var _valid1 = _errs8 === errors;
  errors = _errs7;
  if (vErrors !== null) {
    if (_errs7) {
      vErrors.length = _errs7;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs10 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.workspace === void 0) {
        const err4 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "workspace" }, message: "must have required property 'workspace'" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    var _valid1 = _errs10 === errors;
    valid3 = _valid1;
  }
  if (!valid3) {
    const err5 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.title === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.position === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "position" }, message: "must have required property 'position'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.output_var === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "output_var" }, message: "must have required property 'output_var'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema77.properties, key0)) {
        const err11 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern0.test(data2)) {
          const err12 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.title !== void 0) {
      let data3 = data.title;
      if (typeof data3 === "string") {
        if (func3(data3) > 120) {
          const err14 = { instancePath: instancePath + "/title", schemaPath: "#/properties/title/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err15 = { instancePath: instancePath + "/title", schemaPath: "#/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/title", schemaPath: "#/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      let data4 = data.type;
      if (!(data4 === "START" || data4 === "INPUT" || data4 === "SKILL" || data4 === "WORKSPACE" || data4 === "HTTP" || data4 === "CONDITION" || data4 === "OUTPUT")) {
        const err17 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/enum", keyword: "enum", params: { allowedValues: schema77.properties.type.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.skill_name !== void 0) {
      let data5 = data.skill_name;
      if (typeof data5 === "string") {
        if (!pattern0.test(data5)) {
          const err18 = { instancePath: instancePath + "/skill_name", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/skill_name", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.workspace !== void 0) {
      let data6 = data.workspace;
      if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
        if (data6.agentSkillId === void 0) {
          const err20 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/required", keyword: "required", params: { missingProperty: "agentSkillId" }, message: "must have required property 'agentSkillId'" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
        if (data6.skillIds === void 0) {
          const err21 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/required", keyword: "required", params: { missingProperty: "skillIds" }, message: "must have required property 'skillIds'" };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
        if (data6.maxIterations === void 0) {
          const err22 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/required", keyword: "required", params: { missingProperty: "maxIterations" }, message: "must have required property 'maxIterations'" };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
        for (const key1 in data6) {
          if (!(key1 === "agentSkillId" || key1 === "skillIds" || key1 === "maxIterations" || key1 === "agentName" || key1 === "agentPrompt")) {
            const err23 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err23];
            } else {
              vErrors.push(err23);
            }
            errors++;
          }
        }
        if (data6.agentSkillId !== void 0) {
          let data7 = data6.agentSkillId;
          if (typeof data7 === "string") {
            if (!pattern0.test(data7)) {
              const err24 = { instancePath: instancePath + "/workspace/agentSkillId", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
          } else {
            const err25 = { instancePath: instancePath + "/workspace/agentSkillId", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
        if (data6.skillIds !== void 0) {
          let data8 = data6.skillIds;
          if (Array.isArray(data8)) {
            if (data8.length > 256) {
              const err26 = { instancePath: instancePath + "/workspace/skillIds", schemaPath: "#/properties/workspace/properties/skillIds/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
              if (vErrors === null) {
                vErrors = [err26];
              } else {
                vErrors.push(err26);
              }
              errors++;
            }
            const len0 = data8.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data9 = data8[i0];
              if (typeof data9 === "string") {
                if (!pattern0.test(data9)) {
                  const err27 = { instancePath: instancePath + "/workspace/skillIds/" + i0, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err27];
                  } else {
                    vErrors.push(err27);
                  }
                  errors++;
                }
              } else {
                const err28 = { instancePath: instancePath + "/workspace/skillIds/" + i0, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err28];
                } else {
                  vErrors.push(err28);
                }
                errors++;
              }
            }
            let i1 = data8.length;
            let j0;
            if (i1 > 1) {
              outer0: for (; i1--; ) {
                for (j0 = i1; j0--; ) {
                  if (func0(data8[i1], data8[j0])) {
                    const err29 = { instancePath: instancePath + "/workspace/skillIds", schemaPath: "#/properties/workspace/properties/skillIds/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                    if (vErrors === null) {
                      vErrors = [err29];
                    } else {
                      vErrors.push(err29);
                    }
                    errors++;
                    break outer0;
                  }
                }
              }
            }
          } else {
            const err30 = { instancePath: instancePath + "/workspace/skillIds", schemaPath: "#/properties/workspace/properties/skillIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err30];
            } else {
              vErrors.push(err30);
            }
            errors++;
          }
        }
        if (data6.maxIterations !== void 0) {
          let data10 = data6.maxIterations;
          if (!(typeof data10 == "number" && (!(data10 % 1) && !isNaN(data10)) && isFinite(data10))) {
            const err31 = { instancePath: instancePath + "/workspace/maxIterations", schemaPath: "#/properties/workspace/properties/maxIterations/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err31];
            } else {
              vErrors.push(err31);
            }
            errors++;
          }
          if (typeof data10 == "number" && isFinite(data10)) {
            if (data10 > 10 || isNaN(data10)) {
              const err32 = { instancePath: instancePath + "/workspace/maxIterations", schemaPath: "#/properties/workspace/properties/maxIterations/maximum", keyword: "maximum", params: { comparison: "<=", limit: 10 }, message: "must be <= 10" };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
            if (data10 < 1 || isNaN(data10)) {
              const err33 = { instancePath: instancePath + "/workspace/maxIterations", schemaPath: "#/properties/workspace/properties/maxIterations/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
            }
          }
        }
        if (data6.agentName !== void 0) {
          let data11 = data6.agentName;
          if (typeof data11 === "string") {
            if (func3(data11) > 120) {
              const err34 = { instancePath: instancePath + "/workspace/agentName", schemaPath: "#/properties/workspace/properties/agentName/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err34];
              } else {
                vErrors.push(err34);
              }
              errors++;
            }
          } else {
            const err35 = { instancePath: instancePath + "/workspace/agentName", schemaPath: "#/properties/workspace/properties/agentName/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
        if (data6.agentPrompt !== void 0) {
          let data12 = data6.agentPrompt;
          if (typeof data12 === "string") {
            if (func3(data12) > 1048576) {
              const err36 = { instancePath: instancePath + "/workspace/agentPrompt", schemaPath: "#/properties/workspace/properties/agentPrompt/maxLength", keyword: "maxLength", params: { limit: 1048576 }, message: "must NOT have more than 1048576 characters" };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
          } else {
            const err37 = { instancePath: instancePath + "/workspace/agentPrompt", schemaPath: "#/properties/workspace/properties/agentPrompt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err37];
            } else {
              vErrors.push(err37);
            }
            errors++;
          }
        }
      } else {
        const err38 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
    }
    if (data.config !== void 0) {
      let data13 = data.config;
      if (!(data13 && typeof data13 == "object" && !Array.isArray(data13))) {
        const err39 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.output_var !== void 0) {
      let data14 = data.output_var;
      if (typeof data14 === "string") {
        if (func3(data14) > 64) {
          const err40 = { instancePath: instancePath + "/output_var", schemaPath: "#/properties/output_var/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        if (!pattern39.test(data14)) {
          const err41 = { instancePath: instancePath + "/output_var", schemaPath: "#/properties/output_var/pattern", keyword: "pattern", params: { pattern: "^$|^[A-Za-z_][A-Za-z0-9_]{0,63}$" }, message: 'must match pattern "^$|^[A-Za-z_][A-Za-z0-9_]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
      } else {
        const err42 = { instancePath: instancePath + "/output_var", schemaPath: "#/properties/output_var/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err42];
        } else {
          vErrors.push(err42);
        }
        errors++;
      }
    }
    if (data.position !== void 0) {
      let data15 = data.position;
      if (data15 && typeof data15 == "object" && !Array.isArray(data15)) {
        if (data15.x === void 0) {
          const err43 = { instancePath: instancePath + "/position", schemaPath: "#/properties/position/required", keyword: "required", params: { missingProperty: "x" }, message: "must have required property 'x'" };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
        if (data15.y === void 0) {
          const err44 = { instancePath: instancePath + "/position", schemaPath: "#/properties/position/required", keyword: "required", params: { missingProperty: "y" }, message: "must have required property 'y'" };
          if (vErrors === null) {
            vErrors = [err44];
          } else {
            vErrors.push(err44);
          }
          errors++;
        }
        for (const key2 in data15) {
          if (!(key2 === "x" || key2 === "y")) {
            const err45 = { instancePath: instancePath + "/position", schemaPath: "#/properties/position/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        }
        if (data15.x !== void 0) {
          let data16 = data15.x;
          if (typeof data16 == "number" && isFinite(data16)) {
            if (data16 > 1e6 || isNaN(data16)) {
              const err46 = { instancePath: instancePath + "/position/x", schemaPath: "#/properties/position/properties/x/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1e6 }, message: "must be <= 1000000" };
              if (vErrors === null) {
                vErrors = [err46];
              } else {
                vErrors.push(err46);
              }
              errors++;
            }
            if (data16 < -1e6 || isNaN(data16)) {
              const err47 = { instancePath: instancePath + "/position/x", schemaPath: "#/properties/position/properties/x/minimum", keyword: "minimum", params: { comparison: ">=", limit: -1e6 }, message: "must be >= -1000000" };
              if (vErrors === null) {
                vErrors = [err47];
              } else {
                vErrors.push(err47);
              }
              errors++;
            }
          } else {
            const err48 = { instancePath: instancePath + "/position/x", schemaPath: "#/properties/position/properties/x/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            if (vErrors === null) {
              vErrors = [err48];
            } else {
              vErrors.push(err48);
            }
            errors++;
          }
        }
        if (data15.y !== void 0) {
          let data17 = data15.y;
          if (typeof data17 == "number" && isFinite(data17)) {
            if (data17 > 1e6 || isNaN(data17)) {
              const err49 = { instancePath: instancePath + "/position/y", schemaPath: "#/properties/position/properties/y/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1e6 }, message: "must be <= 1000000" };
              if (vErrors === null) {
                vErrors = [err49];
              } else {
                vErrors.push(err49);
              }
              errors++;
            }
            if (data17 < -1e6 || isNaN(data17)) {
              const err50 = { instancePath: instancePath + "/position/y", schemaPath: "#/properties/position/properties/y/minimum", keyword: "minimum", params: { comparison: ">=", limit: -1e6 }, message: "must be >= -1000000" };
              if (vErrors === null) {
                vErrors = [err50];
              } else {
                vErrors.push(err50);
              }
              errors++;
            }
          } else {
            const err51 = { instancePath: instancePath + "/position/y", schemaPath: "#/properties/position/properties/y/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            if (vErrors === null) {
              vErrors = [err51];
            } else {
              vErrors.push(err51);
            }
            errors++;
          }
        }
      } else {
        const err52 = { instancePath: instancePath + "/position", schemaPath: "#/properties/position/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err52];
        } else {
          vErrors.push(err52);
        }
        errors++;
      }
    }
    if (data.icon !== void 0) {
      let data18 = data.icon;
      if (typeof data18 === "string") {
        if (func3(data18) > 16) {
          const err53 = { instancePath: instancePath + "/icon", schemaPath: "#/properties/icon/maxLength", keyword: "maxLength", params: { limit: 16 }, message: "must NOT have more than 16 characters" };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
      } else {
        const err54 = { instancePath: instancePath + "/icon", schemaPath: "#/properties/icon/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err54];
        } else {
          vErrors.push(err54);
        }
        errors++;
      }
    }
    if (data.tone !== void 0) {
      let data19 = data.tone;
      if (typeof data19 === "string") {
        if (func3(data19) > 32) {
          const err55 = { instancePath: instancePath + "/tone", schemaPath: "#/properties/tone/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
      } else {
        const err56 = { instancePath: instancePath + "/tone", schemaPath: "#/properties/tone/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err56];
        } else {
          vErrors.push(err56);
        }
        errors++;
      }
    }
    if (data.note !== void 0) {
      let data20 = data.note;
      if (typeof data20 === "string") {
        if (func3(data20) > 1e3) {
          const err57 = { instancePath: instancePath + "/note", schemaPath: "#/properties/note/maxLength", keyword: "maxLength", params: { limit: 1e3 }, message: "must NOT have more than 1000 characters" };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
      } else {
        const err58 = { instancePath: instancePath + "/note", schemaPath: "#/properties/note/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err58];
        } else {
          vErrors.push(err58);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data21 = data.timeoutMs;
      if (!(typeof data21 == "number" && (!(data21 % 1) && !isNaN(data21)) && isFinite(data21))) {
        const err59 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err59];
        } else {
          vErrors.push(err59);
        }
        errors++;
      }
      if (typeof data21 == "number" && isFinite(data21)) {
        if (data21 > 6e5 || isNaN(data21)) {
          const err60 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e5 }, message: "must be <= 600000" };
          if (vErrors === null) {
            vErrors = [err60];
          } else {
            vErrors.push(err60);
          }
          errors++;
        }
        if (data21 < 1 || isNaN(data21)) {
          const err61 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
          if (vErrors === null) {
            vErrors = [err61];
          } else {
            vErrors.push(err61);
          }
          errors++;
        }
      }
    }
    if (data.retry !== void 0) {
      let data22 = data.retry;
      if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
        for (const key3 in data22) {
          if (!(key3 === "maxAttempts" || key3 === "delayMs" || key3 === "backoff")) {
            const err62 = { instancePath: instancePath + "/retry", schemaPath: "#/properties/retry/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
        }
        if (data22.maxAttempts !== void 0) {
          let data23 = data22.maxAttempts;
          if (!(typeof data23 == "number" && (!(data23 % 1) && !isNaN(data23)) && isFinite(data23))) {
            const err63 = { instancePath: instancePath + "/retry/maxAttempts", schemaPath: "#/properties/retry/properties/maxAttempts/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
          if (typeof data23 == "number" && isFinite(data23)) {
            if (data23 > 10 || isNaN(data23)) {
              const err64 = { instancePath: instancePath + "/retry/maxAttempts", schemaPath: "#/properties/retry/properties/maxAttempts/maximum", keyword: "maximum", params: { comparison: "<=", limit: 10 }, message: "must be <= 10" };
              if (vErrors === null) {
                vErrors = [err64];
              } else {
                vErrors.push(err64);
              }
              errors++;
            }
            if (data23 < 1 || isNaN(data23)) {
              const err65 = { instancePath: instancePath + "/retry/maxAttempts", schemaPath: "#/properties/retry/properties/maxAttempts/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err65];
              } else {
                vErrors.push(err65);
              }
              errors++;
            }
          }
        }
        if (data22.delayMs !== void 0) {
          let data24 = data22.delayMs;
          if (!(typeof data24 == "number" && (!(data24 % 1) && !isNaN(data24)) && isFinite(data24))) {
            const err66 = { instancePath: instancePath + "/retry/delayMs", schemaPath: "#/properties/retry/properties/delayMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err66];
            } else {
              vErrors.push(err66);
            }
            errors++;
          }
          if (typeof data24 == "number" && isFinite(data24)) {
            if (data24 > 6e4 || isNaN(data24)) {
              const err67 = { instancePath: instancePath + "/retry/delayMs", schemaPath: "#/properties/retry/properties/delayMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e4 }, message: "must be <= 60000" };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
            if (data24 < 0 || isNaN(data24)) {
              const err68 = { instancePath: instancePath + "/retry/delayMs", schemaPath: "#/properties/retry/properties/delayMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
          }
        }
        if (data22.backoff !== void 0) {
          let data25 = data22.backoff;
          if (!(data25 === "fixed" || data25 === "exponential")) {
            const err69 = { instancePath: instancePath + "/retry/backoff", schemaPath: "#/properties/retry/properties/backoff/enum", keyword: "enum", params: { allowedValues: schema77.properties.retry.properties.backoff.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err69];
            } else {
              vErrors.push(err69);
            }
            errors++;
          }
        }
      } else {
        const err70 = { instancePath: instancePath + "/retry", schemaPath: "#/properties/retry/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err70];
        } else {
          vErrors.push(err70);
        }
        errors++;
      }
    }
    if (data.onError !== void 0) {
      let data26 = data.onError;
      if (!(data26 === "stop" || data26 === "continue")) {
        const err71 = { instancePath: instancePath + "/onError", schemaPath: "#/properties/onError/enum", keyword: "enum", params: { allowedValues: schema77.properties.onError.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err71];
        } else {
          vErrors.push(err71);
        }
        errors++;
      }
    }
  } else {
    const err72 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err72];
    } else {
      vErrors.push(err72);
    }
    errors++;
  }
  validate51.errors = vErrors;
  return errors === 0;
}
var nodeV5 = validate54;
var schema96 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v5/node.schema.json", "title": "AgComm .ai node v5", "type": "object", "required": ["id", "title", "type", "position", "output_var"], "properties": { "id": { "$ref": "#/definitions/id" }, "title": { "type": "string", "minLength": 1, "maxLength": 120 }, "type": { "enum": ["START", "INPUT", "SKILL", "WORKSPACE", "HTTP", "CONDITION", "CODE", "CONTACT", "OUTPUT"] }, "skill_name": { "$ref": "#/definitions/id" }, "code_id": { "$ref": "#/definitions/id" }, "workspace": { "type": "object", "required": ["agentSkillId", "skillIds", "maxIterations"], "properties": { "agentSkillId": { "$ref": "#/definitions/id" }, "skillIds": { "type": "array", "maxItems": 256, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } }, "maxIterations": { "type": "integer", "minimum": 1, "maximum": 10 }, "agentName": { "type": "string", "maxLength": 120 }, "agentPrompt": { "type": "string", "maxLength": 1048576 } }, "additionalProperties": false }, "config": { "type": "object" }, "output_var": { "type": "string", "maxLength": 64, "pattern": "^$|^[A-Za-z_][A-Za-z0-9_]{0,63}$" }, "position": { "type": "object", "required": ["x", "y"], "properties": { "x": { "type": "number", "minimum": -1e6, "maximum": 1e6 }, "y": { "type": "number", "minimum": -1e6, "maximum": 1e6 } }, "additionalProperties": false }, "icon": { "type": "string", "maxLength": 16 }, "tone": { "type": "string", "maxLength": 32 }, "note": { "type": "string", "maxLength": 1e3 }, "timeoutMs": { "type": "integer", "minimum": 1, "maximum": 6e5 }, "retry": { "type": "object", "properties": { "maxAttempts": { "type": "integer", "minimum": 1, "maximum": 10 }, "delayMs": { "type": "integer", "minimum": 0, "maximum": 6e4 }, "backoff": { "enum": ["fixed", "exponential"] } }, "additionalProperties": false }, "onError": { "enum": ["stop", "continue"] } }, "additionalProperties": false, "allOf": [{ "if": { "properties": { "type": { "const": "SKILL" } } }, "then": { "required": ["skill_name"] } }, { "if": { "properties": { "type": { "const": "WORKSPACE" } } }, "then": { "required": ["workspace"] } }, { "if": { "properties": { "type": { "const": "CODE" } } }, "then": { "required": ["code_id", "config"], "properties": { "config": { "type": "object", "required": ["codeId", "input"], "properties": { "codeId": { "$ref": "#/definitions/id" }, "input": {} }, "additionalProperties": false } } } }, { "if": { "properties": { "type": { "const": "CONTACT" } } }, "then": { "required": ["config"], "properties": { "config": { "type": "object", "required": ["title", "body", "severity", "webhook"], "properties": { "title": { "type": "string", "minLength": 1, "maxLength": 120 }, "body": { "type": "string", "maxLength": 65536 }, "severity": { "enum": ["info", "warning", "critical"] }, "webhook": { "type": "boolean" }, "dedupeKey": { "type": "string", "maxLength": 256 } }, "additionalProperties": false } } } }], "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
function validate54(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.type !== void 0) {
      if ("SKILL" !== data.type) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.skill_name === void 0) {
        const err1 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "skill_name" }, message: "must have required property 'skill_name'" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err2 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err2];
    } else {
      vErrors.push(err2);
    }
    errors++;
  }
  const _errs7 = errors;
  let valid3 = true;
  const _errs8 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.type !== void 0) {
      if ("WORKSPACE" !== data.type) {
        const err3 = {};
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
  }
  var _valid1 = _errs8 === errors;
  errors = _errs7;
  if (vErrors !== null) {
    if (_errs7) {
      vErrors.length = _errs7;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs10 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.workspace === void 0) {
        const err4 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "workspace" }, message: "must have required property 'workspace'" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    var _valid1 = _errs10 === errors;
    valid3 = _valid1;
  }
  if (!valid3) {
    const err5 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  }
  const _errs12 = errors;
  let valid5 = true;
  const _errs13 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.type !== void 0) {
      if ("CODE" !== data.type) {
        const err6 = {};
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  }
  var _valid2 = _errs13 === errors;
  errors = _errs12;
  if (vErrors !== null) {
    if (_errs12) {
      vErrors.length = _errs12;
    } else {
      vErrors = null;
    }
  }
  if (_valid2) {
    const _errs15 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.code_id === void 0) {
        const err7 = { instancePath, schemaPath: "#/allOf/2/then/required", keyword: "required", params: { missingProperty: "code_id" }, message: "must have required property 'code_id'" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
      if (data.config === void 0) {
        const err8 = { instancePath, schemaPath: "#/allOf/2/then/required", keyword: "required", params: { missingProperty: "config" }, message: "must have required property 'config'" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      if (data.config !== void 0) {
        let data3 = data.config;
        if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
          if (data3.codeId === void 0) {
            const err9 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/2/then/properties/config/required", keyword: "required", params: { missingProperty: "codeId" }, message: "must have required property 'codeId'" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
          if (data3.input === void 0) {
            const err10 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/2/then/properties/config/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
          for (const key0 in data3) {
            if (!(key0 === "codeId" || key0 === "input")) {
              const err11 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/2/then/properties/config/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
          }
          if (data3.codeId !== void 0) {
            let data4 = data3.codeId;
            if (typeof data4 === "string") {
              if (!pattern0.test(data4)) {
                const err12 = { instancePath: instancePath + "/config/codeId", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
              }
            } else {
              const err13 = { instancePath: instancePath + "/config/codeId", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
          }
        } else {
          const err14 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/2/then/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      }
    }
    var _valid2 = _errs15 === errors;
    valid5 = _valid2;
  }
  if (!valid5) {
    const err15 = { instancePath, schemaPath: "#/allOf/2/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err15];
    } else {
      vErrors.push(err15);
    }
    errors++;
  }
  const _errs23 = errors;
  let valid10 = true;
  const _errs24 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.type !== void 0) {
      if ("CONTACT" !== data.type) {
        const err16 = {};
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
  }
  var _valid3 = _errs24 === errors;
  errors = _errs23;
  if (vErrors !== null) {
    if (_errs23) {
      vErrors.length = _errs23;
    } else {
      vErrors = null;
    }
  }
  if (_valid3) {
    const _errs26 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.config === void 0) {
        const err17 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "config" }, message: "must have required property 'config'" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (data.config !== void 0) {
        let data6 = data.config;
        if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
          if (data6.title === void 0) {
            const err18 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/3/then/properties/config/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
            if (vErrors === null) {
              vErrors = [err18];
            } else {
              vErrors.push(err18);
            }
            errors++;
          }
          if (data6.body === void 0) {
            const err19 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/3/then/properties/config/required", keyword: "required", params: { missingProperty: "body" }, message: "must have required property 'body'" };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
          if (data6.severity === void 0) {
            const err20 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/3/then/properties/config/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
          if (data6.webhook === void 0) {
            const err21 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/3/then/properties/config/required", keyword: "required", params: { missingProperty: "webhook" }, message: "must have required property 'webhook'" };
            if (vErrors === null) {
              vErrors = [err21];
            } else {
              vErrors.push(err21);
            }
            errors++;
          }
          for (const key1 in data6) {
            if (!(key1 === "title" || key1 === "body" || key1 === "severity" || key1 === "webhook" || key1 === "dedupeKey")) {
              const err22 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/3/then/properties/config/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
          }
          if (data6.title !== void 0) {
            let data7 = data6.title;
            if (typeof data7 === "string") {
              if (func3(data7) > 120) {
                const err23 = { instancePath: instancePath + "/config/title", schemaPath: "#/allOf/3/then/properties/config/properties/title/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
              if (func3(data7) < 1) {
                const err24 = { instancePath: instancePath + "/config/title", schemaPath: "#/allOf/3/then/properties/config/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err24];
                } else {
                  vErrors.push(err24);
                }
                errors++;
              }
            } else {
              const err25 = { instancePath: instancePath + "/config/title", schemaPath: "#/allOf/3/then/properties/config/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
          }
          if (data6.body !== void 0) {
            let data8 = data6.body;
            if (typeof data8 === "string") {
              if (func3(data8) > 65536) {
                const err26 = { instancePath: instancePath + "/config/body", schemaPath: "#/allOf/3/then/properties/config/properties/body/maxLength", keyword: "maxLength", params: { limit: 65536 }, message: "must NOT have more than 65536 characters" };
                if (vErrors === null) {
                  vErrors = [err26];
                } else {
                  vErrors.push(err26);
                }
                errors++;
              }
            } else {
              const err27 = { instancePath: instancePath + "/config/body", schemaPath: "#/allOf/3/then/properties/config/properties/body/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err27];
              } else {
                vErrors.push(err27);
              }
              errors++;
            }
          }
          if (data6.severity !== void 0) {
            let data9 = data6.severity;
            if (!(data9 === "info" || data9 === "warning" || data9 === "critical")) {
              const err28 = { instancePath: instancePath + "/config/severity", schemaPath: "#/allOf/3/then/properties/config/properties/severity/enum", keyword: "enum", params: { allowedValues: schema96.allOf[3].then.properties.config.properties.severity.enum }, message: "must be equal to one of the allowed values" };
              if (vErrors === null) {
                vErrors = [err28];
              } else {
                vErrors.push(err28);
              }
              errors++;
            }
          }
          if (data6.webhook !== void 0) {
            if (typeof data6.webhook !== "boolean") {
              const err29 = { instancePath: instancePath + "/config/webhook", schemaPath: "#/allOf/3/then/properties/config/properties/webhook/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
              if (vErrors === null) {
                vErrors = [err29];
              } else {
                vErrors.push(err29);
              }
              errors++;
            }
          }
          if (data6.dedupeKey !== void 0) {
            let data11 = data6.dedupeKey;
            if (typeof data11 === "string") {
              if (func3(data11) > 256) {
                const err30 = { instancePath: instancePath + "/config/dedupeKey", schemaPath: "#/allOf/3/then/properties/config/properties/dedupeKey/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
                if (vErrors === null) {
                  vErrors = [err30];
                } else {
                  vErrors.push(err30);
                }
                errors++;
              }
            } else {
              const err31 = { instancePath: instancePath + "/config/dedupeKey", schemaPath: "#/allOf/3/then/properties/config/properties/dedupeKey/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
          }
        } else {
          const err32 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/3/then/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
      }
    }
    var _valid3 = _errs26 === errors;
    valid10 = _valid3;
  }
  if (!valid10) {
    const err33 = { instancePath, schemaPath: "#/allOf/3/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err33];
    } else {
      vErrors.push(err33);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err34 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err34];
      } else {
        vErrors.push(err34);
      }
      errors++;
    }
    if (data.title === void 0) {
      const err35 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
      if (vErrors === null) {
        vErrors = [err35];
      } else {
        vErrors.push(err35);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err36 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err36];
      } else {
        vErrors.push(err36);
      }
      errors++;
    }
    if (data.position === void 0) {
      const err37 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "position" }, message: "must have required property 'position'" };
      if (vErrors === null) {
        vErrors = [err37];
      } else {
        vErrors.push(err37);
      }
      errors++;
    }
    if (data.output_var === void 0) {
      const err38 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "output_var" }, message: "must have required property 'output_var'" };
      if (vErrors === null) {
        vErrors = [err38];
      } else {
        vErrors.push(err38);
      }
      errors++;
    }
    for (const key2 in data) {
      if (!func2.call(schema96.properties, key2)) {
        const err39 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data12 = data.id;
      if (typeof data12 === "string") {
        if (!pattern0.test(data12)) {
          const err40 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
      } else {
        const err41 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err41];
        } else {
          vErrors.push(err41);
        }
        errors++;
      }
    }
    if (data.title !== void 0) {
      let data13 = data.title;
      if (typeof data13 === "string") {
        if (func3(data13) > 120) {
          const err42 = { instancePath: instancePath + "/title", schemaPath: "#/properties/title/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
        if (func3(data13) < 1) {
          const err43 = { instancePath: instancePath + "/title", schemaPath: "#/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
      } else {
        const err44 = { instancePath: instancePath + "/title", schemaPath: "#/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err44];
        } else {
          vErrors.push(err44);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      let data14 = data.type;
      if (!(data14 === "START" || data14 === "INPUT" || data14 === "SKILL" || data14 === "WORKSPACE" || data14 === "HTTP" || data14 === "CONDITION" || data14 === "CODE" || data14 === "CONTACT" || data14 === "OUTPUT")) {
        const err45 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/enum", keyword: "enum", params: { allowedValues: schema96.properties.type.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err45];
        } else {
          vErrors.push(err45);
        }
        errors++;
      }
    }
    if (data.skill_name !== void 0) {
      let data15 = data.skill_name;
      if (typeof data15 === "string") {
        if (!pattern0.test(data15)) {
          const err46 = { instancePath: instancePath + "/skill_name", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err46];
          } else {
            vErrors.push(err46);
          }
          errors++;
        }
      } else {
        const err47 = { instancePath: instancePath + "/skill_name", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err47];
        } else {
          vErrors.push(err47);
        }
        errors++;
      }
    }
    if (data.code_id !== void 0) {
      let data16 = data.code_id;
      if (typeof data16 === "string") {
        if (!pattern0.test(data16)) {
          const err48 = { instancePath: instancePath + "/code_id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err48];
          } else {
            vErrors.push(err48);
          }
          errors++;
        }
      } else {
        const err49 = { instancePath: instancePath + "/code_id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
    }
    if (data.workspace !== void 0) {
      let data17 = data.workspace;
      if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
        if (data17.agentSkillId === void 0) {
          const err50 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/required", keyword: "required", params: { missingProperty: "agentSkillId" }, message: "must have required property 'agentSkillId'" };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        }
        if (data17.skillIds === void 0) {
          const err51 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/required", keyword: "required", params: { missingProperty: "skillIds" }, message: "must have required property 'skillIds'" };
          if (vErrors === null) {
            vErrors = [err51];
          } else {
            vErrors.push(err51);
          }
          errors++;
        }
        if (data17.maxIterations === void 0) {
          const err52 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/required", keyword: "required", params: { missingProperty: "maxIterations" }, message: "must have required property 'maxIterations'" };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
        for (const key3 in data17) {
          if (!(key3 === "agentSkillId" || key3 === "skillIds" || key3 === "maxIterations" || key3 === "agentName" || key3 === "agentPrompt")) {
            const err53 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err53];
            } else {
              vErrors.push(err53);
            }
            errors++;
          }
        }
        if (data17.agentSkillId !== void 0) {
          let data18 = data17.agentSkillId;
          if (typeof data18 === "string") {
            if (!pattern0.test(data18)) {
              const err54 = { instancePath: instancePath + "/workspace/agentSkillId", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err54];
              } else {
                vErrors.push(err54);
              }
              errors++;
            }
          } else {
            const err55 = { instancePath: instancePath + "/workspace/agentSkillId", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err55];
            } else {
              vErrors.push(err55);
            }
            errors++;
          }
        }
        if (data17.skillIds !== void 0) {
          let data19 = data17.skillIds;
          if (Array.isArray(data19)) {
            if (data19.length > 256) {
              const err56 = { instancePath: instancePath + "/workspace/skillIds", schemaPath: "#/properties/workspace/properties/skillIds/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
              if (vErrors === null) {
                vErrors = [err56];
              } else {
                vErrors.push(err56);
              }
              errors++;
            }
            const len0 = data19.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data20 = data19[i0];
              if (typeof data20 === "string") {
                if (!pattern0.test(data20)) {
                  const err57 = { instancePath: instancePath + "/workspace/skillIds/" + i0, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err57];
                  } else {
                    vErrors.push(err57);
                  }
                  errors++;
                }
              } else {
                const err58 = { instancePath: instancePath + "/workspace/skillIds/" + i0, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err58];
                } else {
                  vErrors.push(err58);
                }
                errors++;
              }
            }
            let i1 = data19.length;
            let j0;
            if (i1 > 1) {
              outer0: for (; i1--; ) {
                for (j0 = i1; j0--; ) {
                  if (func0(data19[i1], data19[j0])) {
                    const err59 = { instancePath: instancePath + "/workspace/skillIds", schemaPath: "#/properties/workspace/properties/skillIds/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                    if (vErrors === null) {
                      vErrors = [err59];
                    } else {
                      vErrors.push(err59);
                    }
                    errors++;
                    break outer0;
                  }
                }
              }
            }
          } else {
            const err60 = { instancePath: instancePath + "/workspace/skillIds", schemaPath: "#/properties/workspace/properties/skillIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
        }
        if (data17.maxIterations !== void 0) {
          let data21 = data17.maxIterations;
          if (!(typeof data21 == "number" && (!(data21 % 1) && !isNaN(data21)) && isFinite(data21))) {
            const err61 = { instancePath: instancePath + "/workspace/maxIterations", schemaPath: "#/properties/workspace/properties/maxIterations/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
          if (typeof data21 == "number" && isFinite(data21)) {
            if (data21 > 10 || isNaN(data21)) {
              const err62 = { instancePath: instancePath + "/workspace/maxIterations", schemaPath: "#/properties/workspace/properties/maxIterations/maximum", keyword: "maximum", params: { comparison: "<=", limit: 10 }, message: "must be <= 10" };
              if (vErrors === null) {
                vErrors = [err62];
              } else {
                vErrors.push(err62);
              }
              errors++;
            }
            if (data21 < 1 || isNaN(data21)) {
              const err63 = { instancePath: instancePath + "/workspace/maxIterations", schemaPath: "#/properties/workspace/properties/maxIterations/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err63];
              } else {
                vErrors.push(err63);
              }
              errors++;
            }
          }
        }
        if (data17.agentName !== void 0) {
          let data22 = data17.agentName;
          if (typeof data22 === "string") {
            if (func3(data22) > 120) {
              const err64 = { instancePath: instancePath + "/workspace/agentName", schemaPath: "#/properties/workspace/properties/agentName/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err64];
              } else {
                vErrors.push(err64);
              }
              errors++;
            }
          } else {
            const err65 = { instancePath: instancePath + "/workspace/agentName", schemaPath: "#/properties/workspace/properties/agentName/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err65];
            } else {
              vErrors.push(err65);
            }
            errors++;
          }
        }
        if (data17.agentPrompt !== void 0) {
          let data23 = data17.agentPrompt;
          if (typeof data23 === "string") {
            if (func3(data23) > 1048576) {
              const err66 = { instancePath: instancePath + "/workspace/agentPrompt", schemaPath: "#/properties/workspace/properties/agentPrompt/maxLength", keyword: "maxLength", params: { limit: 1048576 }, message: "must NOT have more than 1048576 characters" };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
          } else {
            const err67 = { instancePath: instancePath + "/workspace/agentPrompt", schemaPath: "#/properties/workspace/properties/agentPrompt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err67];
            } else {
              vErrors.push(err67);
            }
            errors++;
          }
        }
      } else {
        const err68 = { instancePath: instancePath + "/workspace", schemaPath: "#/properties/workspace/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err68];
        } else {
          vErrors.push(err68);
        }
        errors++;
      }
    }
    if (data.config !== void 0) {
      let data24 = data.config;
      if (!(data24 && typeof data24 == "object" && !Array.isArray(data24))) {
        const err69 = { instancePath: instancePath + "/config", schemaPath: "#/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err69];
        } else {
          vErrors.push(err69);
        }
        errors++;
      }
    }
    if (data.output_var !== void 0) {
      let data25 = data.output_var;
      if (typeof data25 === "string") {
        if (func3(data25) > 64) {
          const err70 = { instancePath: instancePath + "/output_var", schemaPath: "#/properties/output_var/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err70];
          } else {
            vErrors.push(err70);
          }
          errors++;
        }
        if (!pattern39.test(data25)) {
          const err71 = { instancePath: instancePath + "/output_var", schemaPath: "#/properties/output_var/pattern", keyword: "pattern", params: { pattern: "^$|^[A-Za-z_][A-Za-z0-9_]{0,63}$" }, message: 'must match pattern "^$|^[A-Za-z_][A-Za-z0-9_]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err71];
          } else {
            vErrors.push(err71);
          }
          errors++;
        }
      } else {
        const err72 = { instancePath: instancePath + "/output_var", schemaPath: "#/properties/output_var/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err72];
        } else {
          vErrors.push(err72);
        }
        errors++;
      }
    }
    if (data.position !== void 0) {
      let data26 = data.position;
      if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
        if (data26.x === void 0) {
          const err73 = { instancePath: instancePath + "/position", schemaPath: "#/properties/position/required", keyword: "required", params: { missingProperty: "x" }, message: "must have required property 'x'" };
          if (vErrors === null) {
            vErrors = [err73];
          } else {
            vErrors.push(err73);
          }
          errors++;
        }
        if (data26.y === void 0) {
          const err74 = { instancePath: instancePath + "/position", schemaPath: "#/properties/position/required", keyword: "required", params: { missingProperty: "y" }, message: "must have required property 'y'" };
          if (vErrors === null) {
            vErrors = [err74];
          } else {
            vErrors.push(err74);
          }
          errors++;
        }
        for (const key4 in data26) {
          if (!(key4 === "x" || key4 === "y")) {
            const err75 = { instancePath: instancePath + "/position", schemaPath: "#/properties/position/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err75];
            } else {
              vErrors.push(err75);
            }
            errors++;
          }
        }
        if (data26.x !== void 0) {
          let data27 = data26.x;
          if (typeof data27 == "number" && isFinite(data27)) {
            if (data27 > 1e6 || isNaN(data27)) {
              const err76 = { instancePath: instancePath + "/position/x", schemaPath: "#/properties/position/properties/x/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1e6 }, message: "must be <= 1000000" };
              if (vErrors === null) {
                vErrors = [err76];
              } else {
                vErrors.push(err76);
              }
              errors++;
            }
            if (data27 < -1e6 || isNaN(data27)) {
              const err77 = { instancePath: instancePath + "/position/x", schemaPath: "#/properties/position/properties/x/minimum", keyword: "minimum", params: { comparison: ">=", limit: -1e6 }, message: "must be >= -1000000" };
              if (vErrors === null) {
                vErrors = [err77];
              } else {
                vErrors.push(err77);
              }
              errors++;
            }
          } else {
            const err78 = { instancePath: instancePath + "/position/x", schemaPath: "#/properties/position/properties/x/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            if (vErrors === null) {
              vErrors = [err78];
            } else {
              vErrors.push(err78);
            }
            errors++;
          }
        }
        if (data26.y !== void 0) {
          let data28 = data26.y;
          if (typeof data28 == "number" && isFinite(data28)) {
            if (data28 > 1e6 || isNaN(data28)) {
              const err79 = { instancePath: instancePath + "/position/y", schemaPath: "#/properties/position/properties/y/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1e6 }, message: "must be <= 1000000" };
              if (vErrors === null) {
                vErrors = [err79];
              } else {
                vErrors.push(err79);
              }
              errors++;
            }
            if (data28 < -1e6 || isNaN(data28)) {
              const err80 = { instancePath: instancePath + "/position/y", schemaPath: "#/properties/position/properties/y/minimum", keyword: "minimum", params: { comparison: ">=", limit: -1e6 }, message: "must be >= -1000000" };
              if (vErrors === null) {
                vErrors = [err80];
              } else {
                vErrors.push(err80);
              }
              errors++;
            }
          } else {
            const err81 = { instancePath: instancePath + "/position/y", schemaPath: "#/properties/position/properties/y/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            if (vErrors === null) {
              vErrors = [err81];
            } else {
              vErrors.push(err81);
            }
            errors++;
          }
        }
      } else {
        const err82 = { instancePath: instancePath + "/position", schemaPath: "#/properties/position/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err82];
        } else {
          vErrors.push(err82);
        }
        errors++;
      }
    }
    if (data.icon !== void 0) {
      let data29 = data.icon;
      if (typeof data29 === "string") {
        if (func3(data29) > 16) {
          const err83 = { instancePath: instancePath + "/icon", schemaPath: "#/properties/icon/maxLength", keyword: "maxLength", params: { limit: 16 }, message: "must NOT have more than 16 characters" };
          if (vErrors === null) {
            vErrors = [err83];
          } else {
            vErrors.push(err83);
          }
          errors++;
        }
      } else {
        const err84 = { instancePath: instancePath + "/icon", schemaPath: "#/properties/icon/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err84];
        } else {
          vErrors.push(err84);
        }
        errors++;
      }
    }
    if (data.tone !== void 0) {
      let data30 = data.tone;
      if (typeof data30 === "string") {
        if (func3(data30) > 32) {
          const err85 = { instancePath: instancePath + "/tone", schemaPath: "#/properties/tone/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err85];
          } else {
            vErrors.push(err85);
          }
          errors++;
        }
      } else {
        const err86 = { instancePath: instancePath + "/tone", schemaPath: "#/properties/tone/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err86];
        } else {
          vErrors.push(err86);
        }
        errors++;
      }
    }
    if (data.note !== void 0) {
      let data31 = data.note;
      if (typeof data31 === "string") {
        if (func3(data31) > 1e3) {
          const err87 = { instancePath: instancePath + "/note", schemaPath: "#/properties/note/maxLength", keyword: "maxLength", params: { limit: 1e3 }, message: "must NOT have more than 1000 characters" };
          if (vErrors === null) {
            vErrors = [err87];
          } else {
            vErrors.push(err87);
          }
          errors++;
        }
      } else {
        const err88 = { instancePath: instancePath + "/note", schemaPath: "#/properties/note/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err88];
        } else {
          vErrors.push(err88);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data32 = data.timeoutMs;
      if (!(typeof data32 == "number" && (!(data32 % 1) && !isNaN(data32)) && isFinite(data32))) {
        const err89 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err89];
        } else {
          vErrors.push(err89);
        }
        errors++;
      }
      if (typeof data32 == "number" && isFinite(data32)) {
        if (data32 > 6e5 || isNaN(data32)) {
          const err90 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e5 }, message: "must be <= 600000" };
          if (vErrors === null) {
            vErrors = [err90];
          } else {
            vErrors.push(err90);
          }
          errors++;
        }
        if (data32 < 1 || isNaN(data32)) {
          const err91 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
          if (vErrors === null) {
            vErrors = [err91];
          } else {
            vErrors.push(err91);
          }
          errors++;
        }
      }
    }
    if (data.retry !== void 0) {
      let data33 = data.retry;
      if (data33 && typeof data33 == "object" && !Array.isArray(data33)) {
        for (const key5 in data33) {
          if (!(key5 === "maxAttempts" || key5 === "delayMs" || key5 === "backoff")) {
            const err92 = { instancePath: instancePath + "/retry", schemaPath: "#/properties/retry/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err92];
            } else {
              vErrors.push(err92);
            }
            errors++;
          }
        }
        if (data33.maxAttempts !== void 0) {
          let data34 = data33.maxAttempts;
          if (!(typeof data34 == "number" && (!(data34 % 1) && !isNaN(data34)) && isFinite(data34))) {
            const err93 = { instancePath: instancePath + "/retry/maxAttempts", schemaPath: "#/properties/retry/properties/maxAttempts/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err93];
            } else {
              vErrors.push(err93);
            }
            errors++;
          }
          if (typeof data34 == "number" && isFinite(data34)) {
            if (data34 > 10 || isNaN(data34)) {
              const err94 = { instancePath: instancePath + "/retry/maxAttempts", schemaPath: "#/properties/retry/properties/maxAttempts/maximum", keyword: "maximum", params: { comparison: "<=", limit: 10 }, message: "must be <= 10" };
              if (vErrors === null) {
                vErrors = [err94];
              } else {
                vErrors.push(err94);
              }
              errors++;
            }
            if (data34 < 1 || isNaN(data34)) {
              const err95 = { instancePath: instancePath + "/retry/maxAttempts", schemaPath: "#/properties/retry/properties/maxAttempts/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err95];
              } else {
                vErrors.push(err95);
              }
              errors++;
            }
          }
        }
        if (data33.delayMs !== void 0) {
          let data35 = data33.delayMs;
          if (!(typeof data35 == "number" && (!(data35 % 1) && !isNaN(data35)) && isFinite(data35))) {
            const err96 = { instancePath: instancePath + "/retry/delayMs", schemaPath: "#/properties/retry/properties/delayMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err96];
            } else {
              vErrors.push(err96);
            }
            errors++;
          }
          if (typeof data35 == "number" && isFinite(data35)) {
            if (data35 > 6e4 || isNaN(data35)) {
              const err97 = { instancePath: instancePath + "/retry/delayMs", schemaPath: "#/properties/retry/properties/delayMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e4 }, message: "must be <= 60000" };
              if (vErrors === null) {
                vErrors = [err97];
              } else {
                vErrors.push(err97);
              }
              errors++;
            }
            if (data35 < 0 || isNaN(data35)) {
              const err98 = { instancePath: instancePath + "/retry/delayMs", schemaPath: "#/properties/retry/properties/delayMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err98];
              } else {
                vErrors.push(err98);
              }
              errors++;
            }
          }
        }
        if (data33.backoff !== void 0) {
          let data36 = data33.backoff;
          if (!(data36 === "fixed" || data36 === "exponential")) {
            const err99 = { instancePath: instancePath + "/retry/backoff", schemaPath: "#/properties/retry/properties/backoff/enum", keyword: "enum", params: { allowedValues: schema96.properties.retry.properties.backoff.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err99];
            } else {
              vErrors.push(err99);
            }
            errors++;
          }
        }
      } else {
        const err100 = { instancePath: instancePath + "/retry", schemaPath: "#/properties/retry/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err100];
        } else {
          vErrors.push(err100);
        }
        errors++;
      }
    }
    if (data.onError !== void 0) {
      let data37 = data.onError;
      if (!(data37 === "stop" || data37 === "continue")) {
        const err101 = { instancePath: instancePath + "/onError", schemaPath: "#/properties/onError/enum", keyword: "enum", params: { allowedValues: schema96.properties.onError.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err101];
        } else {
          vErrors.push(err101);
        }
        errors++;
      }
    }
  } else {
    const err102 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err102];
    } else {
      vErrors.push(err102);
    }
    errors++;
  }
  validate54.errors = vErrors;
  return errors === 0;
}
var nodeV6 = validate55;
function validate55(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (!validate54(data, { instancePath, parentData, parentDataProperty, rootData })) {
    vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
    errors = vErrors.length;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.type !== void 0) {
      if ("WORKSPACE" !== data.type) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.config !== void 0) {
        let data1 = data.config;
        if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
          if (data1.hookIds !== void 0) {
            let data2 = data1.hookIds;
            if (Array.isArray(data2)) {
              if (data2.length > 16) {
                const err1 = { instancePath: instancePath + "/config/hookIds", schemaPath: "#/allOf/1/then/properties/config/properties/hookIds/maxItems", keyword: "maxItems", params: { limit: 16 }, message: "must NOT have more than 16 items" };
                if (vErrors === null) {
                  vErrors = [err1];
                } else {
                  vErrors.push(err1);
                }
                errors++;
              }
              const len0 = data2.length;
              for (let i0 = 0; i0 < len0; i0++) {
                let data3 = data2[i0];
                if (typeof data3 === "string") {
                  if (!pattern0.test(data3)) {
                    const err2 = { instancePath: instancePath + "/config/hookIds/" + i0, schemaPath: "#/allOf/1/then/properties/config/properties/hookIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                    if (vErrors === null) {
                      vErrors = [err2];
                    } else {
                      vErrors.push(err2);
                    }
                    errors++;
                  }
                } else {
                  const err3 = { instancePath: instancePath + "/config/hookIds/" + i0, schemaPath: "#/allOf/1/then/properties/config/properties/hookIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err3];
                  } else {
                    vErrors.push(err3);
                  }
                  errors++;
                }
              }
              let i1 = data2.length;
              let j0;
              if (i1 > 1) {
                const indices0 = {};
                for (; i1--; ) {
                  let item0 = data2[i1];
                  if (typeof item0 !== "string") {
                    continue;
                  }
                  if (typeof indices0[item0] == "number") {
                    j0 = indices0[item0];
                    const err4 = { instancePath: instancePath + "/config/hookIds", schemaPath: "#/allOf/1/then/properties/config/properties/hookIds/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                    if (vErrors === null) {
                      vErrors = [err4];
                    } else {
                      vErrors.push(err4);
                    }
                    errors++;
                    break;
                  }
                  indices0[item0] = i1;
                }
              }
            } else {
              const err5 = { instancePath: instancePath + "/config/hookIds", schemaPath: "#/allOf/1/then/properties/config/properties/hookIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
          }
        } else {
          const err6 = { instancePath: instancePath + "/config", schemaPath: "#/allOf/1/then/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err7 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate55.errors = vErrors;
  return errors === 0;
}
var nodeV7 = validate57;
function validate57(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (!validate55(data, { instancePath, parentData, parentDataProperty, rootData })) {
    vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
    errors = vErrors.length;
  }
  validate57.errors = vErrors;
  return errors === 0;
}
var nodeBeta1 = validate59;
function validate59(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (!validate57(data, { instancePath, parentData, parentDataProperty, rootData })) {
    vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
    errors = vErrors.length;
  }
  validate59.errors = vErrors;
  return errors === 0;
}
var skillV1 = validate61;
var schema106 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v1/skill.schema.json", "title": "AgComm .ai Skill v2", "type": "object", "required": ["name", "description", "category", "plugin_ids"], "properties": { "id": { "$ref": "#/definitions/id" }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "description": { "type": "string", "maxLength": 2e3 }, "category": { "type": "string", "minLength": 1, "maxLength": 64 }, "tags": { "type": "array", "maxItems": 32, "uniqueItems": true, "items": { "type": "string", "maxLength": 64 } }, "icon": { "type": "string", "maxLength": 16 }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "type": "string", "maxLength": 128 } }, "plugin_ids": { "type": "array", "maxItems": 256, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
function validate61(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.description === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.category === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "category" }, message: "must have required property 'category'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.plugin_ids === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "plugin_ids" }, message: "must have required property 'plugin_ids'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema106.properties, key0)) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err5 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data1 = data.version;
      if (typeof data1 === "string") {
        if (func3(data1) > 32) {
          const err7 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        if (func3(data1) < 1) {
          const err8 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data2 = data.name;
      if (typeof data2 === "string") {
        if (func3(data2) > 120) {
          const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (func3(data2) < 1) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.description !== void 0) {
      let data3 = data.description;
      if (typeof data3 === "string") {
        if (func3(data3) > 2e3) {
          const err13 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.category !== void 0) {
      let data4 = data.category;
      if (typeof data4 === "string") {
        if (func3(data4) > 64) {
          const err15 = { instancePath: instancePath + "/category", schemaPath: "#/properties/category/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (func3(data4) < 1) {
          const err16 = { instancePath: instancePath + "/category", schemaPath: "#/properties/category/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/category", schemaPath: "#/properties/category/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.tags !== void 0) {
      let data5 = data.tags;
      if (Array.isArray(data5)) {
        if (data5.length > 32) {
          const err18 = { instancePath: instancePath + "/tags", schemaPath: "#/properties/tags/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        const len0 = data5.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data6 = data5[i0];
          if (typeof data6 === "string") {
            if (func3(data6) > 64) {
              const err19 = { instancePath: instancePath + "/tags/" + i0, schemaPath: "#/properties/tags/items/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
          } else {
            const err20 = { instancePath: instancePath + "/tags/" + i0, schemaPath: "#/properties/tags/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
        }
        let i1 = data5.length;
        let j0;
        if (i1 > 1) {
          const indices0 = {};
          for (; i1--; ) {
            let item0 = data5[i1];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j0 = indices0[item0];
              const err21 = { instancePath: instancePath + "/tags", schemaPath: "#/properties/tags/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
              break;
            }
            indices0[item0] = i1;
          }
        }
      } else {
        const err22 = { instancePath: instancePath + "/tags", schemaPath: "#/properties/tags/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.icon !== void 0) {
      let data7 = data.icon;
      if (typeof data7 === "string") {
        if (func3(data7) > 16) {
          const err23 = { instancePath: instancePath + "/icon", schemaPath: "#/properties/icon/maxLength", keyword: "maxLength", params: { limit: 16 }, message: "must NOT have more than 16 characters" };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
      } else {
        const err24 = { instancePath: instancePath + "/icon", schemaPath: "#/properties/icon/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.permissions !== void 0) {
      let data8 = data.permissions;
      if (Array.isArray(data8)) {
        if (data8.length > 64) {
          const err25 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
        const len1 = data8.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data9 = data8[i2];
          if (typeof data9 === "string") {
            if (func3(data9) > 128) {
              const err26 = { instancePath: instancePath + "/permissions/" + i2, schemaPath: "#/properties/permissions/items/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err26];
              } else {
                vErrors.push(err26);
              }
              errors++;
            }
          } else {
            const err27 = { instancePath: instancePath + "/permissions/" + i2, schemaPath: "#/properties/permissions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err27];
            } else {
              vErrors.push(err27);
            }
            errors++;
          }
        }
        let i3 = data8.length;
        let j1;
        if (i3 > 1) {
          const indices1 = {};
          for (; i3--; ) {
            let item1 = data8[i3];
            if (typeof item1 !== "string") {
              continue;
            }
            if (typeof indices1[item1] == "number") {
              j1 = indices1[item1];
              const err28 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i3, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i3 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err28];
              } else {
                vErrors.push(err28);
              }
              errors++;
              break;
            }
            indices1[item1] = i3;
          }
        }
      } else {
        const err29 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.plugin_ids !== void 0) {
      let data10 = data.plugin_ids;
      if (Array.isArray(data10)) {
        if (data10.length > 256) {
          const err30 = { instancePath: instancePath + "/plugin_ids", schemaPath: "#/properties/plugin_ids/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        const len2 = data10.length;
        for (let i4 = 0; i4 < len2; i4++) {
          let data11 = data10[i4];
          if (typeof data11 === "string") {
            if (!pattern0.test(data11)) {
              const err31 = { instancePath: instancePath + "/plugin_ids/" + i4, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
          } else {
            const err32 = { instancePath: instancePath + "/plugin_ids/" + i4, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        let i5 = data10.length;
        let j2;
        if (i5 > 1) {
          outer0: for (; i5--; ) {
            for (j2 = i5; j2--; ) {
              if (func0(data10[i5], data10[j2])) {
                const err33 = { instancePath: instancePath + "/plugin_ids", schemaPath: "#/properties/plugin_ids/uniqueItems", keyword: "uniqueItems", params: { i: i5, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i5 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err33];
                } else {
                  vErrors.push(err33);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err34 = { instancePath: instancePath + "/plugin_ids", schemaPath: "#/properties/plugin_ids/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
  } else {
    const err35 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err35];
    } else {
      vErrors.push(err35);
    }
    errors++;
  }
  validate61.errors = vErrors;
  return errors === 0;
}
var skillV2 = validate62;
var schema109 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v2/skill.schema.json", "title": "AgComm .ai Skill v2", "type": "object", "required": ["id", "version", "name", "description", "category", "plugin_ids"], "properties": { "id": { "$ref": "#/definitions/id" }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "description": { "type": "string", "maxLength": 2e3 }, "category": { "type": "string", "minLength": 1, "maxLength": 64 }, "tags": { "type": "array", "maxItems": 32, "uniqueItems": true, "items": { "type": "string", "maxLength": 64 } }, "icon": { "type": "string", "maxLength": 16 }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "type": "string", "maxLength": 128 } }, "plugin_ids": { "type": "array", "maxItems": 256, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
function validate62(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.description === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.category === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "category" }, message: "must have required property 'category'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.plugin_ids === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "plugin_ids" }, message: "must have required property 'plugin_ids'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema109.properties, key0)) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data1 = data.version;
      if (typeof data1 === "string") {
        if (func3(data1) > 32) {
          const err9 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (func3(data1) < 1) {
          const err10 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data2 = data.name;
      if (typeof data2 === "string") {
        if (func3(data2) > 120) {
          const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (func3(data2) < 1) {
          const err13 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.description !== void 0) {
      let data3 = data.description;
      if (typeof data3 === "string") {
        if (func3(data3) > 2e3) {
          const err15 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.category !== void 0) {
      let data4 = data.category;
      if (typeof data4 === "string") {
        if (func3(data4) > 64) {
          const err17 = { instancePath: instancePath + "/category", schemaPath: "#/properties/category/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
        if (func3(data4) < 1) {
          const err18 = { instancePath: instancePath + "/category", schemaPath: "#/properties/category/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/category", schemaPath: "#/properties/category/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.tags !== void 0) {
      let data5 = data.tags;
      if (Array.isArray(data5)) {
        if (data5.length > 32) {
          const err20 = { instancePath: instancePath + "/tags", schemaPath: "#/properties/tags/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
        const len0 = data5.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data6 = data5[i0];
          if (typeof data6 === "string") {
            if (func3(data6) > 64) {
              const err21 = { instancePath: instancePath + "/tags/" + i0, schemaPath: "#/properties/tags/items/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          } else {
            const err22 = { instancePath: instancePath + "/tags/" + i0, schemaPath: "#/properties/tags/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
        let i1 = data5.length;
        let j0;
        if (i1 > 1) {
          const indices0 = {};
          for (; i1--; ) {
            let item0 = data5[i1];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j0 = indices0[item0];
              const err23 = { instancePath: instancePath + "/tags", schemaPath: "#/properties/tags/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
              break;
            }
            indices0[item0] = i1;
          }
        }
      } else {
        const err24 = { instancePath: instancePath + "/tags", schemaPath: "#/properties/tags/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.icon !== void 0) {
      let data7 = data.icon;
      if (typeof data7 === "string") {
        if (func3(data7) > 16) {
          const err25 = { instancePath: instancePath + "/icon", schemaPath: "#/properties/icon/maxLength", keyword: "maxLength", params: { limit: 16 }, message: "must NOT have more than 16 characters" };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
      } else {
        const err26 = { instancePath: instancePath + "/icon", schemaPath: "#/properties/icon/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.permissions !== void 0) {
      let data8 = data.permissions;
      if (Array.isArray(data8)) {
        if (data8.length > 64) {
          const err27 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err27];
          } else {
            vErrors.push(err27);
          }
          errors++;
        }
        const len1 = data8.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data9 = data8[i2];
          if (typeof data9 === "string") {
            if (func3(data9) > 128) {
              const err28 = { instancePath: instancePath + "/permissions/" + i2, schemaPath: "#/properties/permissions/items/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err28];
              } else {
                vErrors.push(err28);
              }
              errors++;
            }
          } else {
            const err29 = { instancePath: instancePath + "/permissions/" + i2, schemaPath: "#/properties/permissions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err29];
            } else {
              vErrors.push(err29);
            }
            errors++;
          }
        }
        let i3 = data8.length;
        let j1;
        if (i3 > 1) {
          const indices1 = {};
          for (; i3--; ) {
            let item1 = data8[i3];
            if (typeof item1 !== "string") {
              continue;
            }
            if (typeof indices1[item1] == "number") {
              j1 = indices1[item1];
              const err30 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i3, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i3 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err30];
              } else {
                vErrors.push(err30);
              }
              errors++;
              break;
            }
            indices1[item1] = i3;
          }
        }
      } else {
        const err31 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    if (data.plugin_ids !== void 0) {
      let data10 = data.plugin_ids;
      if (Array.isArray(data10)) {
        if (data10.length > 256) {
          const err32 = { instancePath: instancePath + "/plugin_ids", schemaPath: "#/properties/plugin_ids/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
        const len2 = data10.length;
        for (let i4 = 0; i4 < len2; i4++) {
          let data11 = data10[i4];
          if (typeof data11 === "string") {
            if (!pattern0.test(data11)) {
              const err33 = { instancePath: instancePath + "/plugin_ids/" + i4, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
            }
          } else {
            const err34 = { instancePath: instancePath + "/plugin_ids/" + i4, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err34];
            } else {
              vErrors.push(err34);
            }
            errors++;
          }
        }
        let i5 = data10.length;
        let j2;
        if (i5 > 1) {
          outer0: for (; i5--; ) {
            for (j2 = i5; j2--; ) {
              if (func0(data10[i5], data10[j2])) {
                const err35 = { instancePath: instancePath + "/plugin_ids", schemaPath: "#/properties/plugin_ids/uniqueItems", keyword: "uniqueItems", params: { i: i5, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i5 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err35];
                } else {
                  vErrors.push(err35);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err36 = { instancePath: instancePath + "/plugin_ids", schemaPath: "#/properties/plugin_ids/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
    }
  } else {
    const err37 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err37];
    } else {
      vErrors.push(err37);
    }
    errors++;
  }
  validate62.errors = vErrors;
  return errors === 0;
}
var plugin = validate63;
var schema112 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v2/plugin.schema.json", "title": "AgComm .ai Plugin manifest", "type": "object", "required": ["id", "name", "description", "version", "permissions"], "properties": { "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "description": { "type": "string", "maxLength": 2e3 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "sdkVersion": { "const": "1" }, "language": { "const": "typescript" }, "entry": { "const": "dist/index.js" }, "author": { "type": "object", "required": ["name"], "additionalProperties": false, "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "url": { "type": "string", "pattern": "^https://", "maxLength": 2048 } } }, "license": { "type": "string", "minLength": 1, "maxLength": 64 }, "homepage": { "type": "string", "pattern": "^https://", "maxLength": 2048 }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "type": "string", "pattern": "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" } }, "tools": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "object", "required": ["name", "description"], "additionalProperties": false, "properties": { "name": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,47}$" }, "description": { "type": "string", "minLength": 1, "maxLength": 500 }, "inputSchema": { "type": "object" }, "outputSchema": { "type": "object" }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "type": "string", "pattern": "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" } } } } }, "limits": { "type": "object", "additionalProperties": false, "properties": { "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 12e4 }, "maxOutputBytes": { "type": "integer", "minimum": 1024, "maximum": 1048576 }, "maxConcurrency": { "type": "integer", "minimum": 1, "maximum": 16 } } }, "integrity": { "type": "string", "pattern": "^sha256-[A-Za-z0-9+/_=-]{43,48}$" }, "signature": { "type": "object", "required": ["algorithm", "keyId", "value"], "additionalProperties": false, "properties": { "algorithm": { "const": "Ed25519" }, "keyId": { "type": "string", "minLength": 1, "maxLength": 64 }, "value": { "type": "string", "minLength": 40, "maxLength": 256 } } }, "runtime": { "enum": ["player", "server"] }, "endpoint": { "type": "string", "minLength": 1, "maxLength": 2048, "pattern": "^https://" }, "source": { "const": "custom" } }, "anyOf": [{ "required": ["sdkVersion", "language", "entry"] }, { "required": ["runtime", "source"] }], "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
var pattern67 = new RegExp("^https://", "u");
var pattern69 = new RegExp("^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$", "u");
var pattern70 = new RegExp("^[A-Za-z][A-Za-z0-9_-]{0,47}$", "u");
var pattern72 = new RegExp("^sha256-[A-Za-z0-9+/_=-]{43,48}$", "u");
function validate63(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs1 = errors;
  let valid0 = false;
  const _errs2 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.sdkVersion === void 0) {
      const err0 = { instancePath, schemaPath: "#/anyOf/0/required", keyword: "required", params: { missingProperty: "sdkVersion" }, message: "must have required property 'sdkVersion'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.language === void 0) {
      const err1 = { instancePath, schemaPath: "#/anyOf/0/required", keyword: "required", params: { missingProperty: "language" }, message: "must have required property 'language'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.entry === void 0) {
      const err2 = { instancePath, schemaPath: "#/anyOf/0/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
  }
  var _valid0 = _errs2 === errors;
  valid0 = valid0 || _valid0;
  if (!valid0) {
    const _errs3 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.runtime === void 0) {
        const err3 = { instancePath, schemaPath: "#/anyOf/1/required", keyword: "required", params: { missingProperty: "runtime" }, message: "must have required property 'runtime'" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
      if (data.source === void 0) {
        const err4 = { instancePath, schemaPath: "#/anyOf/1/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    var _valid0 = _errs3 === errors;
    valid0 = valid0 || _valid0;
  }
  if (!valid0) {
    const err5 = { instancePath, schemaPath: "#/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  } else {
    errors = _errs1;
    if (vErrors !== null) {
      if (_errs1) {
        vErrors.length = _errs1;
      } else {
        vErrors = null;
      }
    }
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.description === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.permissions === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "permissions" }, message: "must have required property 'permissions'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema112.properties, key0)) {
        const err11 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err12 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data1 = data.name;
      if (typeof data1 === "string") {
        if (func3(data1) > 120) {
          const err14 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (func3(data1) < 1) {
          const err15 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.description !== void 0) {
      let data2 = data.description;
      if (typeof data2 === "string") {
        if (func3(data2) > 2e3) {
          const err17 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      } else {
        const err18 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data3 = data.version;
      if (typeof data3 === "string") {
        if (func3(data3) > 32) {
          const err19 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err20 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.sdkVersion !== void 0) {
      if ("1" !== data.sdkVersion) {
        const err22 = { instancePath: instancePath + "/sdkVersion", schemaPath: "#/properties/sdkVersion/const", keyword: "const", params: { allowedValue: "1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.language !== void 0) {
      if ("typescript" !== data.language) {
        const err23 = { instancePath: instancePath + "/language", schemaPath: "#/properties/language/const", keyword: "const", params: { allowedValue: "typescript" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.entry !== void 0) {
      if ("dist/index.js" !== data.entry) {
        const err24 = { instancePath: instancePath + "/entry", schemaPath: "#/properties/entry/const", keyword: "const", params: { allowedValue: "dist/index.js" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data7 = data.author;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        if (data7.name === void 0) {
          const err25 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
        for (const key1 in data7) {
          if (!(key1 === "name" || key1 === "url")) {
            const err26 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
        if (data7.name !== void 0) {
          let data8 = data7.name;
          if (typeof data8 === "string") {
            if (func3(data8) > 120) {
              const err27 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err27];
              } else {
                vErrors.push(err27);
              }
              errors++;
            }
            if (func3(data8) < 1) {
              const err28 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err28];
              } else {
                vErrors.push(err28);
              }
              errors++;
            }
          } else {
            const err29 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err29];
            } else {
              vErrors.push(err29);
            }
            errors++;
          }
        }
        if (data7.url !== void 0) {
          let data9 = data7.url;
          if (typeof data9 === "string") {
            if (func3(data9) > 2048) {
              const err30 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
              if (vErrors === null) {
                vErrors = [err30];
              } else {
                vErrors.push(err30);
              }
              errors++;
            }
            if (!pattern67.test(data9)) {
              const err31 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
          } else {
            const err32 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
      } else {
        const err33 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
    }
    if (data.license !== void 0) {
      let data10 = data.license;
      if (typeof data10 === "string") {
        if (func3(data10) > 64) {
          const err34 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
        if (func3(data10) < 1) {
          const err35 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
      } else {
        const err36 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
    }
    if (data.homepage !== void 0) {
      let data11 = data.homepage;
      if (typeof data11 === "string") {
        if (func3(data11) > 2048) {
          const err37 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
        if (!pattern67.test(data11)) {
          const err38 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
      } else {
        const err39 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.permissions !== void 0) {
      let data12 = data.permissions;
      if (Array.isArray(data12)) {
        if (data12.length > 64) {
          const err40 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        const len0 = data12.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data13 = data12[i0];
          if (typeof data13 === "string") {
            if (!pattern69.test(data13)) {
              const err41 = { instancePath: instancePath + "/permissions/" + i0, schemaPath: "#/properties/permissions/items/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err41];
              } else {
                vErrors.push(err41);
              }
              errors++;
            }
          } else {
            const err42 = { instancePath: instancePath + "/permissions/" + i0, schemaPath: "#/properties/permissions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
        }
        let i1 = data12.length;
        let j0;
        if (i1 > 1) {
          const indices0 = {};
          for (; i1--; ) {
            let item0 = data12[i1];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j0 = indices0[item0];
              const err43 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err43];
              } else {
                vErrors.push(err43);
              }
              errors++;
              break;
            }
            indices0[item0] = i1;
          }
        }
      } else {
        const err44 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err44];
        } else {
          vErrors.push(err44);
        }
        errors++;
      }
    }
    if (data.tools !== void 0) {
      let data14 = data.tools;
      if (Array.isArray(data14)) {
        if (data14.length > 32) {
          const err45 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err45];
          } else {
            vErrors.push(err45);
          }
          errors++;
        }
        if (data14.length < 1) {
          const err46 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err46];
          } else {
            vErrors.push(err46);
          }
          errors++;
        }
        const len1 = data14.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data15 = data14[i2];
          if (data15 && typeof data15 == "object" && !Array.isArray(data15)) {
            if (data15.name === void 0) {
              const err47 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err47];
              } else {
                vErrors.push(err47);
              }
              errors++;
            }
            if (data15.description === void 0) {
              const err48 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
            for (const key2 in data15) {
              if (!(key2 === "name" || key2 === "description" || key2 === "inputSchema" || key2 === "outputSchema" || key2 === "permissions")) {
                const err49 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/properties/tools/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err49];
                } else {
                  vErrors.push(err49);
                }
                errors++;
              }
            }
            if (data15.name !== void 0) {
              let data16 = data15.name;
              if (typeof data16 === "string") {
                if (!pattern70.test(data16)) {
                  const err50 = { instancePath: instancePath + "/tools/" + i2 + "/name", schemaPath: "#/properties/tools/items/properties/name/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_-]{0,47}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_-]{0,47}$"' };
                  if (vErrors === null) {
                    vErrors = [err50];
                  } else {
                    vErrors.push(err50);
                  }
                  errors++;
                }
              } else {
                const err51 = { instancePath: instancePath + "/tools/" + i2 + "/name", schemaPath: "#/properties/tools/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err51];
                } else {
                  vErrors.push(err51);
                }
                errors++;
              }
            }
            if (data15.description !== void 0) {
              let data17 = data15.description;
              if (typeof data17 === "string") {
                if (func3(data17) > 500) {
                  const err52 = { instancePath: instancePath + "/tools/" + i2 + "/description", schemaPath: "#/properties/tools/items/properties/description/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                  if (vErrors === null) {
                    vErrors = [err52];
                  } else {
                    vErrors.push(err52);
                  }
                  errors++;
                }
                if (func3(data17) < 1) {
                  const err53 = { instancePath: instancePath + "/tools/" + i2 + "/description", schemaPath: "#/properties/tools/items/properties/description/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err53];
                  } else {
                    vErrors.push(err53);
                  }
                  errors++;
                }
              } else {
                const err54 = { instancePath: instancePath + "/tools/" + i2 + "/description", schemaPath: "#/properties/tools/items/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err54];
                } else {
                  vErrors.push(err54);
                }
                errors++;
              }
            }
            if (data15.inputSchema !== void 0) {
              let data18 = data15.inputSchema;
              if (!(data18 && typeof data18 == "object" && !Array.isArray(data18))) {
                const err55 = { instancePath: instancePath + "/tools/" + i2 + "/inputSchema", schemaPath: "#/properties/tools/items/properties/inputSchema/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err55];
                } else {
                  vErrors.push(err55);
                }
                errors++;
              }
            }
            if (data15.outputSchema !== void 0) {
              let data19 = data15.outputSchema;
              if (!(data19 && typeof data19 == "object" && !Array.isArray(data19))) {
                const err56 = { instancePath: instancePath + "/tools/" + i2 + "/outputSchema", schemaPath: "#/properties/tools/items/properties/outputSchema/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err56];
                } else {
                  vErrors.push(err56);
                }
                errors++;
              }
            }
            if (data15.permissions !== void 0) {
              let data20 = data15.permissions;
              if (Array.isArray(data20)) {
                if (data20.length > 64) {
                  const err57 = { instancePath: instancePath + "/tools/" + i2 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
                  if (vErrors === null) {
                    vErrors = [err57];
                  } else {
                    vErrors.push(err57);
                  }
                  errors++;
                }
                const len2 = data20.length;
                for (let i3 = 0; i3 < len2; i3++) {
                  let data21 = data20[i3];
                  if (typeof data21 === "string") {
                    if (!pattern69.test(data21)) {
                      const err58 = { instancePath: instancePath + "/tools/" + i2 + "/permissions/" + i3, schemaPath: "#/properties/tools/items/properties/permissions/items/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$"' };
                      if (vErrors === null) {
                        vErrors = [err58];
                      } else {
                        vErrors.push(err58);
                      }
                      errors++;
                    }
                  } else {
                    const err59 = { instancePath: instancePath + "/tools/" + i2 + "/permissions/" + i3, schemaPath: "#/properties/tools/items/properties/permissions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err59];
                    } else {
                      vErrors.push(err59);
                    }
                    errors++;
                  }
                }
                let i4 = data20.length;
                let j1;
                if (i4 > 1) {
                  const indices1 = {};
                  for (; i4--; ) {
                    let item1 = data20[i4];
                    if (typeof item1 !== "string") {
                      continue;
                    }
                    if (typeof indices1[item1] == "number") {
                      j1 = indices1[item1];
                      const err60 = { instancePath: instancePath + "/tools/" + i2 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i4 + " are identical)" };
                      if (vErrors === null) {
                        vErrors = [err60];
                      } else {
                        vErrors.push(err60);
                      }
                      errors++;
                      break;
                    }
                    indices1[item1] = i4;
                  }
                }
              } else {
                const err61 = { instancePath: instancePath + "/tools/" + i2 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                if (vErrors === null) {
                  vErrors = [err61];
                } else {
                  vErrors.push(err61);
                }
                errors++;
              }
            }
          } else {
            const err62 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/properties/tools/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
        }
      } else {
        const err63 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err63];
        } else {
          vErrors.push(err63);
        }
        errors++;
      }
    }
    if (data.limits !== void 0) {
      let data22 = data.limits;
      if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
        for (const key3 in data22) {
          if (!(key3 === "timeoutMs" || key3 === "maxOutputBytes" || key3 === "maxConcurrency")) {
            const err64 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err64];
            } else {
              vErrors.push(err64);
            }
            errors++;
          }
        }
        if (data22.timeoutMs !== void 0) {
          let data23 = data22.timeoutMs;
          if (!(typeof data23 == "number" && (!(data23 % 1) && !isNaN(data23)) && isFinite(data23))) {
            const err65 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err65];
            } else {
              vErrors.push(err65);
            }
            errors++;
          }
          if (typeof data23 == "number" && isFinite(data23)) {
            if (data23 > 12e4 || isNaN(data23)) {
              const err66 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 12e4 }, message: "must be <= 120000" };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
            if (data23 < 100 || isNaN(data23)) {
              const err67 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
          }
        }
        if (data22.maxOutputBytes !== void 0) {
          let data24 = data22.maxOutputBytes;
          if (!(typeof data24 == "number" && (!(data24 % 1) && !isNaN(data24)) && isFinite(data24))) {
            const err68 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err68];
            } else {
              vErrors.push(err68);
            }
            errors++;
          }
          if (typeof data24 == "number" && isFinite(data24)) {
            if (data24 > 1048576 || isNaN(data24)) {
              const err69 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1048576 }, message: "must be <= 1048576" };
              if (vErrors === null) {
                vErrors = [err69];
              } else {
                vErrors.push(err69);
              }
              errors++;
            }
            if (data24 < 1024 || isNaN(data24)) {
              const err70 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1024 }, message: "must be >= 1024" };
              if (vErrors === null) {
                vErrors = [err70];
              } else {
                vErrors.push(err70);
              }
              errors++;
            }
          }
        }
        if (data22.maxConcurrency !== void 0) {
          let data25 = data22.maxConcurrency;
          if (!(typeof data25 == "number" && (!(data25 % 1) && !isNaN(data25)) && isFinite(data25))) {
            const err71 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err71];
            } else {
              vErrors.push(err71);
            }
            errors++;
          }
          if (typeof data25 == "number" && isFinite(data25)) {
            if (data25 > 16 || isNaN(data25)) {
              const err72 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/maximum", keyword: "maximum", params: { comparison: "<=", limit: 16 }, message: "must be <= 16" };
              if (vErrors === null) {
                vErrors = [err72];
              } else {
                vErrors.push(err72);
              }
              errors++;
            }
            if (data25 < 1 || isNaN(data25)) {
              const err73 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err73];
              } else {
                vErrors.push(err73);
              }
              errors++;
            }
          }
        }
      } else {
        const err74 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err74];
        } else {
          vErrors.push(err74);
        }
        errors++;
      }
    }
    if (data.integrity !== void 0) {
      let data26 = data.integrity;
      if (typeof data26 === "string") {
        if (!pattern72.test(data26)) {
          const err75 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/pattern", keyword: "pattern", params: { pattern: "^sha256-[A-Za-z0-9+/_=-]{43,48}$" }, message: 'must match pattern "^sha256-[A-Za-z0-9+/_=-]{43,48}$"' };
          if (vErrors === null) {
            vErrors = [err75];
          } else {
            vErrors.push(err75);
          }
          errors++;
        }
      } else {
        const err76 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err76];
        } else {
          vErrors.push(err76);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data27 = data.signature;
      if (data27 && typeof data27 == "object" && !Array.isArray(data27)) {
        if (data27.algorithm === void 0) {
          const err77 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
          if (vErrors === null) {
            vErrors = [err77];
          } else {
            vErrors.push(err77);
          }
          errors++;
        }
        if (data27.keyId === void 0) {
          const err78 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "keyId" }, message: "must have required property 'keyId'" };
          if (vErrors === null) {
            vErrors = [err78];
          } else {
            vErrors.push(err78);
          }
          errors++;
        }
        if (data27.value === void 0) {
          const err79 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
          if (vErrors === null) {
            vErrors = [err79];
          } else {
            vErrors.push(err79);
          }
          errors++;
        }
        for (const key4 in data27) {
          if (!(key4 === "algorithm" || key4 === "keyId" || key4 === "value")) {
            const err80 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err80];
            } else {
              vErrors.push(err80);
            }
            errors++;
          }
        }
        if (data27.algorithm !== void 0) {
          if ("Ed25519" !== data27.algorithm) {
            const err81 = { instancePath: instancePath + "/signature/algorithm", schemaPath: "#/properties/signature/properties/algorithm/const", keyword: "const", params: { allowedValue: "Ed25519" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err81];
            } else {
              vErrors.push(err81);
            }
            errors++;
          }
        }
        if (data27.keyId !== void 0) {
          let data29 = data27.keyId;
          if (typeof data29 === "string") {
            if (func3(data29) > 64) {
              const err82 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
              if (vErrors === null) {
                vErrors = [err82];
              } else {
                vErrors.push(err82);
              }
              errors++;
            }
            if (func3(data29) < 1) {
              const err83 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err83];
              } else {
                vErrors.push(err83);
              }
              errors++;
            }
          } else {
            const err84 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err84];
            } else {
              vErrors.push(err84);
            }
            errors++;
          }
        }
        if (data27.value !== void 0) {
          let data30 = data27.value;
          if (typeof data30 === "string") {
            if (func3(data30) > 256) {
              const err85 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
              if (vErrors === null) {
                vErrors = [err85];
              } else {
                vErrors.push(err85);
              }
              errors++;
            }
            if (func3(data30) < 40) {
              const err86 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/minLength", keyword: "minLength", params: { limit: 40 }, message: "must NOT have fewer than 40 characters" };
              if (vErrors === null) {
                vErrors = [err86];
              } else {
                vErrors.push(err86);
              }
              errors++;
            }
          } else {
            const err87 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err87];
            } else {
              vErrors.push(err87);
            }
            errors++;
          }
        }
      } else {
        const err88 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err88];
        } else {
          vErrors.push(err88);
        }
        errors++;
      }
    }
    if (data.runtime !== void 0) {
      let data31 = data.runtime;
      if (!(data31 === "player" || data31 === "server")) {
        const err89 = { instancePath: instancePath + "/runtime", schemaPath: "#/properties/runtime/enum", keyword: "enum", params: { allowedValues: schema112.properties.runtime.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err89];
        } else {
          vErrors.push(err89);
        }
        errors++;
      }
    }
    if (data.endpoint !== void 0) {
      let data32 = data.endpoint;
      if (typeof data32 === "string") {
        if (func3(data32) > 2048) {
          const err90 = { instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
          if (vErrors === null) {
            vErrors = [err90];
          } else {
            vErrors.push(err90);
          }
          errors++;
        }
        if (func3(data32) < 1) {
          const err91 = { instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err91];
          } else {
            vErrors.push(err91);
          }
          errors++;
        }
        if (!pattern67.test(data32)) {
          const err92 = { instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
          if (vErrors === null) {
            vErrors = [err92];
          } else {
            vErrors.push(err92);
          }
          errors++;
        }
      } else {
        const err93 = { instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err93];
        } else {
          vErrors.push(err93);
        }
        errors++;
      }
    }
    if (data.source !== void 0) {
      if ("custom" !== data.source) {
        const err94 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/const", keyword: "const", params: { allowedValue: "custom" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err94];
        } else {
          vErrors.push(err94);
        }
        errors++;
      }
    }
  } else {
    const err95 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err95];
    } else {
      vErrors.push(err95);
    }
    errors++;
  }
  validate63.errors = vErrors;
  return errors === 0;
}
var pattern80 = new RegExp("^sha256-[A-Za-z0-9+/]{43}=$", "u");
var pluginV5 = validate65;
var schema118 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v5/plugin.schema.json", "title": "AgComm .ai Runtime bundle manifest v5", "type": "object", "required": ["id", "name", "description", "version", "sdkVersion", "language", "entry", "runtime", "source", "permissions", "tools", "integrity"], "properties": { "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "description": { "type": "string", "maxLength": 2e3 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "sdkVersion": { "const": "1" }, "language": { "const": "typescript" }, "entry": { "const": "dist/index.js" }, "runtime": { "const": "runtime" }, "source": { "const": "custom" }, "author": { "type": "object", "required": ["name"], "additionalProperties": false, "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "url": { "type": "string", "pattern": "^https://", "maxLength": 2048 } } }, "license": { "type": "string", "minLength": 1, "maxLength": 64 }, "homepage": { "type": "string", "pattern": "^https://", "maxLength": 2048 }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "$ref": "#/definitions/permission" } }, "tools": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "object", "required": ["name", "description"], "additionalProperties": false, "properties": { "name": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,47}$" }, "description": { "type": "string", "minLength": 1, "maxLength": 500 }, "inputSchema": { "type": "object" }, "outputSchema": { "type": "object" }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "$ref": "#/definitions/permission" } } } } }, "limits": { "type": "object", "additionalProperties": false, "properties": { "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 12e4 }, "maxOutputBytes": { "type": "integer", "minimum": 1024, "maximum": 1048576 }, "maxConcurrency": { "type": "integer", "minimum": 1, "maximum": 16 } } }, "integrity": { "type": "string", "pattern": "^sha256-[A-Za-z0-9+/]{43}=$", "maxLength": 128 }, "signature": { "type": "object", "required": ["algorithm", "keyId", "value"], "additionalProperties": false, "properties": { "algorithm": { "const": "Ed25519" }, "keyId": { "type": "string", "minLength": 1, "maxLength": 128 }, "value": { "type": "string", "minLength": 40, "maxLength": 256 } } } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, "permission": { "type": "string", "pattern": "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" } } };
function validate65(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.description === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.sdkVersion === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sdkVersion" }, message: "must have required property 'sdkVersion'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.language === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "language" }, message: "must have required property 'language'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.entry === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.runtime === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runtime" }, message: "must have required property 'runtime'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.source === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.permissions === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "permissions" }, message: "must have required property 'permissions'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.tools === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tools" }, message: "must have required property 'tools'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.integrity === void 0) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "integrity" }, message: "must have required property 'integrity'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema118.properties, key0)) {
        const err12 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern0.test(data0)) {
          const err13 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data1 = data.name;
      if (typeof data1 === "string") {
        if (func3(data1) > 120) {
          const err15 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (func3(data1) < 1) {
          const err16 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.description !== void 0) {
      let data2 = data.description;
      if (typeof data2 === "string") {
        if (func3(data2) > 2e3) {
          const err18 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data3 = data.version;
      if (typeof data3 === "string") {
        if (func3(data3) > 32) {
          const err20 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
        if (func3(data3) < 1) {
          const err21 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
      } else {
        const err22 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.sdkVersion !== void 0) {
      if ("1" !== data.sdkVersion) {
        const err23 = { instancePath: instancePath + "/sdkVersion", schemaPath: "#/properties/sdkVersion/const", keyword: "const", params: { allowedValue: "1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.language !== void 0) {
      if ("typescript" !== data.language) {
        const err24 = { instancePath: instancePath + "/language", schemaPath: "#/properties/language/const", keyword: "const", params: { allowedValue: "typescript" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.entry !== void 0) {
      if ("dist/index.js" !== data.entry) {
        const err25 = { instancePath: instancePath + "/entry", schemaPath: "#/properties/entry/const", keyword: "const", params: { allowedValue: "dist/index.js" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
    }
    if (data.runtime !== void 0) {
      if ("runtime" !== data.runtime) {
        const err26 = { instancePath: instancePath + "/runtime", schemaPath: "#/properties/runtime/const", keyword: "const", params: { allowedValue: "runtime" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.source !== void 0) {
      if ("custom" !== data.source) {
        const err27 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/const", keyword: "const", params: { allowedValue: "custom" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data9 = data.author;
      if (data9 && typeof data9 == "object" && !Array.isArray(data9)) {
        if (data9.name === void 0) {
          const err28 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
        for (const key1 in data9) {
          if (!(key1 === "name" || key1 === "url")) {
            const err29 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err29];
            } else {
              vErrors.push(err29);
            }
            errors++;
          }
        }
        if (data9.name !== void 0) {
          let data10 = data9.name;
          if (typeof data10 === "string") {
            if (func3(data10) > 120) {
              const err30 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err30];
              } else {
                vErrors.push(err30);
              }
              errors++;
            }
            if (func3(data10) < 1) {
              const err31 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
          } else {
            const err32 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        if (data9.url !== void 0) {
          let data11 = data9.url;
          if (typeof data11 === "string") {
            if (func3(data11) > 2048) {
              const err33 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
            }
            if (!pattern67.test(data11)) {
              const err34 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
              if (vErrors === null) {
                vErrors = [err34];
              } else {
                vErrors.push(err34);
              }
              errors++;
            }
          } else {
            const err35 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
      } else {
        const err36 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
    }
    if (data.license !== void 0) {
      let data12 = data.license;
      if (typeof data12 === "string") {
        if (func3(data12) > 64) {
          const err37 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
        if (func3(data12) < 1) {
          const err38 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
      } else {
        const err39 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.homepage !== void 0) {
      let data13 = data.homepage;
      if (typeof data13 === "string") {
        if (func3(data13) > 2048) {
          const err40 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        if (!pattern67.test(data13)) {
          const err41 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
      } else {
        const err42 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err42];
        } else {
          vErrors.push(err42);
        }
        errors++;
      }
    }
    if (data.permissions !== void 0) {
      let data14 = data.permissions;
      if (Array.isArray(data14)) {
        if (data14.length > 64) {
          const err43 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
        const len0 = data14.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data15 = data14[i0];
          if (typeof data15 === "string") {
            if (!pattern69.test(data15)) {
              const err44 = { instancePath: instancePath + "/permissions/" + i0, schemaPath: "#/definitions/permission/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err44];
              } else {
                vErrors.push(err44);
              }
              errors++;
            }
          } else {
            const err45 = { instancePath: instancePath + "/permissions/" + i0, schemaPath: "#/definitions/permission/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        }
        let i1 = data14.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data14[i1], data14[j0])) {
                const err46 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err46];
                } else {
                  vErrors.push(err46);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err47 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err47];
        } else {
          vErrors.push(err47);
        }
        errors++;
      }
    }
    if (data.tools !== void 0) {
      let data16 = data.tools;
      if (Array.isArray(data16)) {
        if (data16.length > 32) {
          const err48 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err48];
          } else {
            vErrors.push(err48);
          }
          errors++;
        }
        if (data16.length < 1) {
          const err49 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err49];
          } else {
            vErrors.push(err49);
          }
          errors++;
        }
        const len1 = data16.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data17 = data16[i2];
          if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
            if (data17.name === void 0) {
              const err50 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err50];
              } else {
                vErrors.push(err50);
              }
              errors++;
            }
            if (data17.description === void 0) {
              const err51 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
              if (vErrors === null) {
                vErrors = [err51];
              } else {
                vErrors.push(err51);
              }
              errors++;
            }
            for (const key2 in data17) {
              if (!(key2 === "name" || key2 === "description" || key2 === "inputSchema" || key2 === "outputSchema" || key2 === "permissions")) {
                const err52 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/properties/tools/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err52];
                } else {
                  vErrors.push(err52);
                }
                errors++;
              }
            }
            if (data17.name !== void 0) {
              let data18 = data17.name;
              if (typeof data18 === "string") {
                if (!pattern70.test(data18)) {
                  const err53 = { instancePath: instancePath + "/tools/" + i2 + "/name", schemaPath: "#/properties/tools/items/properties/name/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_-]{0,47}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_-]{0,47}$"' };
                  if (vErrors === null) {
                    vErrors = [err53];
                  } else {
                    vErrors.push(err53);
                  }
                  errors++;
                }
              } else {
                const err54 = { instancePath: instancePath + "/tools/" + i2 + "/name", schemaPath: "#/properties/tools/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err54];
                } else {
                  vErrors.push(err54);
                }
                errors++;
              }
            }
            if (data17.description !== void 0) {
              let data19 = data17.description;
              if (typeof data19 === "string") {
                if (func3(data19) > 500) {
                  const err55 = { instancePath: instancePath + "/tools/" + i2 + "/description", schemaPath: "#/properties/tools/items/properties/description/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                  if (vErrors === null) {
                    vErrors = [err55];
                  } else {
                    vErrors.push(err55);
                  }
                  errors++;
                }
                if (func3(data19) < 1) {
                  const err56 = { instancePath: instancePath + "/tools/" + i2 + "/description", schemaPath: "#/properties/tools/items/properties/description/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err56];
                  } else {
                    vErrors.push(err56);
                  }
                  errors++;
                }
              } else {
                const err57 = { instancePath: instancePath + "/tools/" + i2 + "/description", schemaPath: "#/properties/tools/items/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err57];
                } else {
                  vErrors.push(err57);
                }
                errors++;
              }
            }
            if (data17.inputSchema !== void 0) {
              let data20 = data17.inputSchema;
              if (!(data20 && typeof data20 == "object" && !Array.isArray(data20))) {
                const err58 = { instancePath: instancePath + "/tools/" + i2 + "/inputSchema", schemaPath: "#/properties/tools/items/properties/inputSchema/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err58];
                } else {
                  vErrors.push(err58);
                }
                errors++;
              }
            }
            if (data17.outputSchema !== void 0) {
              let data21 = data17.outputSchema;
              if (!(data21 && typeof data21 == "object" && !Array.isArray(data21))) {
                const err59 = { instancePath: instancePath + "/tools/" + i2 + "/outputSchema", schemaPath: "#/properties/tools/items/properties/outputSchema/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err59];
                } else {
                  vErrors.push(err59);
                }
                errors++;
              }
            }
            if (data17.permissions !== void 0) {
              let data22 = data17.permissions;
              if (Array.isArray(data22)) {
                if (data22.length > 64) {
                  const err60 = { instancePath: instancePath + "/tools/" + i2 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
                  if (vErrors === null) {
                    vErrors = [err60];
                  } else {
                    vErrors.push(err60);
                  }
                  errors++;
                }
                const len2 = data22.length;
                for (let i3 = 0; i3 < len2; i3++) {
                  let data23 = data22[i3];
                  if (typeof data23 === "string") {
                    if (!pattern69.test(data23)) {
                      const err61 = { instancePath: instancePath + "/tools/" + i2 + "/permissions/" + i3, schemaPath: "#/definitions/permission/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$"' };
                      if (vErrors === null) {
                        vErrors = [err61];
                      } else {
                        vErrors.push(err61);
                      }
                      errors++;
                    }
                  } else {
                    const err62 = { instancePath: instancePath + "/tools/" + i2 + "/permissions/" + i3, schemaPath: "#/definitions/permission/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err62];
                    } else {
                      vErrors.push(err62);
                    }
                    errors++;
                  }
                }
                let i4 = data22.length;
                let j1;
                if (i4 > 1) {
                  outer1: for (; i4--; ) {
                    for (j1 = i4; j1--; ) {
                      if (func0(data22[i4], data22[j1])) {
                        const err63 = { instancePath: instancePath + "/tools/" + i2 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i4 + " are identical)" };
                        if (vErrors === null) {
                          vErrors = [err63];
                        } else {
                          vErrors.push(err63);
                        }
                        errors++;
                        break outer1;
                      }
                    }
                  }
                }
              } else {
                const err64 = { instancePath: instancePath + "/tools/" + i2 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                if (vErrors === null) {
                  vErrors = [err64];
                } else {
                  vErrors.push(err64);
                }
                errors++;
              }
            }
          } else {
            const err65 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/properties/tools/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err65];
            } else {
              vErrors.push(err65);
            }
            errors++;
          }
        }
      } else {
        const err66 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err66];
        } else {
          vErrors.push(err66);
        }
        errors++;
      }
    }
    if (data.limits !== void 0) {
      let data24 = data.limits;
      if (data24 && typeof data24 == "object" && !Array.isArray(data24)) {
        for (const key3 in data24) {
          if (!(key3 === "timeoutMs" || key3 === "maxOutputBytes" || key3 === "maxConcurrency")) {
            const err67 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err67];
            } else {
              vErrors.push(err67);
            }
            errors++;
          }
        }
        if (data24.timeoutMs !== void 0) {
          let data25 = data24.timeoutMs;
          if (!(typeof data25 == "number" && (!(data25 % 1) && !isNaN(data25)) && isFinite(data25))) {
            const err68 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err68];
            } else {
              vErrors.push(err68);
            }
            errors++;
          }
          if (typeof data25 == "number" && isFinite(data25)) {
            if (data25 > 12e4 || isNaN(data25)) {
              const err69 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 12e4 }, message: "must be <= 120000" };
              if (vErrors === null) {
                vErrors = [err69];
              } else {
                vErrors.push(err69);
              }
              errors++;
            }
            if (data25 < 100 || isNaN(data25)) {
              const err70 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
              if (vErrors === null) {
                vErrors = [err70];
              } else {
                vErrors.push(err70);
              }
              errors++;
            }
          }
        }
        if (data24.maxOutputBytes !== void 0) {
          let data26 = data24.maxOutputBytes;
          if (!(typeof data26 == "number" && (!(data26 % 1) && !isNaN(data26)) && isFinite(data26))) {
            const err71 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err71];
            } else {
              vErrors.push(err71);
            }
            errors++;
          }
          if (typeof data26 == "number" && isFinite(data26)) {
            if (data26 > 1048576 || isNaN(data26)) {
              const err72 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1048576 }, message: "must be <= 1048576" };
              if (vErrors === null) {
                vErrors = [err72];
              } else {
                vErrors.push(err72);
              }
              errors++;
            }
            if (data26 < 1024 || isNaN(data26)) {
              const err73 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1024 }, message: "must be >= 1024" };
              if (vErrors === null) {
                vErrors = [err73];
              } else {
                vErrors.push(err73);
              }
              errors++;
            }
          }
        }
        if (data24.maxConcurrency !== void 0) {
          let data27 = data24.maxConcurrency;
          if (!(typeof data27 == "number" && (!(data27 % 1) && !isNaN(data27)) && isFinite(data27))) {
            const err74 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err74];
            } else {
              vErrors.push(err74);
            }
            errors++;
          }
          if (typeof data27 == "number" && isFinite(data27)) {
            if (data27 > 16 || isNaN(data27)) {
              const err75 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/maximum", keyword: "maximum", params: { comparison: "<=", limit: 16 }, message: "must be <= 16" };
              if (vErrors === null) {
                vErrors = [err75];
              } else {
                vErrors.push(err75);
              }
              errors++;
            }
            if (data27 < 1 || isNaN(data27)) {
              const err76 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err76];
              } else {
                vErrors.push(err76);
              }
              errors++;
            }
          }
        }
      } else {
        const err77 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err77];
        } else {
          vErrors.push(err77);
        }
        errors++;
      }
    }
    if (data.integrity !== void 0) {
      let data28 = data.integrity;
      if (typeof data28 === "string") {
        if (func3(data28) > 128) {
          const err78 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err78];
          } else {
            vErrors.push(err78);
          }
          errors++;
        }
        if (!pattern80.test(data28)) {
          const err79 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/pattern", keyword: "pattern", params: { pattern: "^sha256-[A-Za-z0-9+/]{43}=$" }, message: 'must match pattern "^sha256-[A-Za-z0-9+/]{43}=$"' };
          if (vErrors === null) {
            vErrors = [err79];
          } else {
            vErrors.push(err79);
          }
          errors++;
        }
      } else {
        const err80 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err80];
        } else {
          vErrors.push(err80);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data29 = data.signature;
      if (data29 && typeof data29 == "object" && !Array.isArray(data29)) {
        if (data29.algorithm === void 0) {
          const err81 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
          if (vErrors === null) {
            vErrors = [err81];
          } else {
            vErrors.push(err81);
          }
          errors++;
        }
        if (data29.keyId === void 0) {
          const err82 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "keyId" }, message: "must have required property 'keyId'" };
          if (vErrors === null) {
            vErrors = [err82];
          } else {
            vErrors.push(err82);
          }
          errors++;
        }
        if (data29.value === void 0) {
          const err83 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
          if (vErrors === null) {
            vErrors = [err83];
          } else {
            vErrors.push(err83);
          }
          errors++;
        }
        for (const key4 in data29) {
          if (!(key4 === "algorithm" || key4 === "keyId" || key4 === "value")) {
            const err84 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err84];
            } else {
              vErrors.push(err84);
            }
            errors++;
          }
        }
        if (data29.algorithm !== void 0) {
          if ("Ed25519" !== data29.algorithm) {
            const err85 = { instancePath: instancePath + "/signature/algorithm", schemaPath: "#/properties/signature/properties/algorithm/const", keyword: "const", params: { allowedValue: "Ed25519" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err85];
            } else {
              vErrors.push(err85);
            }
            errors++;
          }
        }
        if (data29.keyId !== void 0) {
          let data31 = data29.keyId;
          if (typeof data31 === "string") {
            if (func3(data31) > 128) {
              const err86 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err86];
              } else {
                vErrors.push(err86);
              }
              errors++;
            }
            if (func3(data31) < 1) {
              const err87 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err87];
              } else {
                vErrors.push(err87);
              }
              errors++;
            }
          } else {
            const err88 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err88];
            } else {
              vErrors.push(err88);
            }
            errors++;
          }
        }
        if (data29.value !== void 0) {
          let data32 = data29.value;
          if (typeof data32 === "string") {
            if (func3(data32) > 256) {
              const err89 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
              if (vErrors === null) {
                vErrors = [err89];
              } else {
                vErrors.push(err89);
              }
              errors++;
            }
            if (func3(data32) < 40) {
              const err90 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/minLength", keyword: "minLength", params: { limit: 40 }, message: "must NOT have fewer than 40 characters" };
              if (vErrors === null) {
                vErrors = [err90];
              } else {
                vErrors.push(err90);
              }
              errors++;
            }
          } else {
            const err91 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err91];
            } else {
              vErrors.push(err91);
            }
            errors++;
          }
        }
      } else {
        const err92 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err92];
        } else {
          vErrors.push(err92);
        }
        errors++;
      }
    }
  } else {
    const err93 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err93];
    } else {
      vErrors.push(err93);
    }
    errors++;
  }
  validate65.errors = vErrors;
  return errors === 0;
}
var pluginV6 = validate66;
var schema122 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/v6/plugin.schema.json", "title": "AgComm .ai Runtime bundle manifest v6", "type": "object", "required": ["id", "name", "description", "version", "sdkVersion", "language", "entry", "runtime", "source", "kind", "permissions", "tools", "integrity"], "properties": { "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "description": { "type": "string", "maxLength": 2e3 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "sdkVersion": { "const": "1" }, "language": { "const": "typescript" }, "entry": { "const": "dist/index.js" }, "runtime": { "const": "runtime" }, "source": { "const": "custom" }, "kind": { "enum": ["plugin", "code", "workspace-hook"] }, "author": { "type": "object", "required": ["name"], "additionalProperties": false, "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "url": { "type": "string", "pattern": "^https://", "maxLength": 2048 } } }, "license": { "type": "string", "minLength": 1, "maxLength": 64 }, "homepage": { "type": "string", "pattern": "^https://", "maxLength": 2048 }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "$ref": "#/definitions/permission" } }, "tools": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "object", "required": ["name", "description", "permissions"], "additionalProperties": false, "properties": { "name": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,47}$" }, "description": { "type": "string", "minLength": 1, "maxLength": 500 }, "inputSchema": { "type": "object" }, "outputSchema": { "type": "object" }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "$ref": "#/definitions/permission" } } } } }, "limits": { "type": "object", "additionalProperties": false, "properties": { "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 12e4 }, "maxOutputBytes": { "type": "integer", "minimum": 1024, "maximum": 1048576 }, "maxConcurrency": { "type": "integer", "minimum": 1, "maximum": 16 } } }, "integrity": { "type": "string", "pattern": "^sha256-[A-Za-z0-9+/]{43}=$", "maxLength": 128 }, "signature": { "type": "object", "required": ["algorithm", "keyId", "value"], "additionalProperties": false, "properties": { "algorithm": { "const": "Ed25519" }, "keyId": { "type": "string", "minLength": 1, "maxLength": 128 }, "value": { "type": "string", "minLength": 40, "maxLength": 256 } } } }, "additionalProperties": false, "allOf": [{ "if": { "properties": { "kind": { "const": "code" } } }, "then": { "properties": { "tools": { "minItems": 1, "maxItems": 1, "items": { "properties": { "name": { "const": "run" } }, "required": ["inputSchema", "outputSchema"] } } } } }, { "if": { "properties": { "kind": { "const": "workspace-hook" } } }, "then": { "properties": { "tools": { "maxItems": 7, "items": { "properties": { "name": { "enum": ["onStart", "beforeModel", "afterModel", "beforeTool", "afterTool", "onFinish", "onError"] } }, "required": ["inputSchema", "outputSchema"] } } } } }], "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, "permission": { "type": "string", "pattern": "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" } } };
function validate66(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind !== void 0) {
      if ("code" !== data.kind) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.tools !== void 0) {
        let data1 = data.tools;
        if (Array.isArray(data1)) {
          if (data1.length > 1) {
            const err1 = { instancePath: instancePath + "/tools", schemaPath: "#/allOf/0/then/properties/tools/maxItems", keyword: "maxItems", params: { limit: 1 }, message: "must NOT have more than 1 items" };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
          if (data1.length < 1) {
            const err2 = { instancePath: instancePath + "/tools", schemaPath: "#/allOf/0/then/properties/tools/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
          const len0 = data1.length;
          for (let i0 = 0; i0 < len0; i0++) {
            let data2 = data1[i0];
            if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
              if (data2.inputSchema === void 0) {
                const err3 = { instancePath: instancePath + "/tools/" + i0, schemaPath: "#/allOf/0/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "inputSchema" }, message: "must have required property 'inputSchema'" };
                if (vErrors === null) {
                  vErrors = [err3];
                } else {
                  vErrors.push(err3);
                }
                errors++;
              }
              if (data2.outputSchema === void 0) {
                const err4 = { instancePath: instancePath + "/tools/" + i0, schemaPath: "#/allOf/0/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "outputSchema" }, message: "must have required property 'outputSchema'" };
                if (vErrors === null) {
                  vErrors = [err4];
                } else {
                  vErrors.push(err4);
                }
                errors++;
              }
              if (data2.name !== void 0) {
                if ("run" !== data2.name) {
                  const err5 = { instancePath: instancePath + "/tools/" + i0 + "/name", schemaPath: "#/allOf/0/then/properties/tools/items/properties/name/const", keyword: "const", params: { allowedValue: "run" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err5];
                  } else {
                    vErrors.push(err5);
                  }
                  errors++;
                }
              }
            }
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err6 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err6];
    } else {
      vErrors.push(err6);
    }
    errors++;
  }
  const _errs10 = errors;
  let valid7 = true;
  const _errs11 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind !== void 0) {
      if ("workspace-hook" !== data.kind) {
        const err7 = {};
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
  }
  var _valid1 = _errs11 === errors;
  errors = _errs10;
  if (vErrors !== null) {
    if (_errs10) {
      vErrors.length = _errs10;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs13 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.tools !== void 0) {
        let data5 = data.tools;
        if (Array.isArray(data5)) {
          if (data5.length > 7) {
            const err8 = { instancePath: instancePath + "/tools", schemaPath: "#/allOf/1/then/properties/tools/maxItems", keyword: "maxItems", params: { limit: 7 }, message: "must NOT have more than 7 items" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
          const len1 = data5.length;
          for (let i1 = 0; i1 < len1; i1++) {
            let data6 = data5[i1];
            if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
              if (data6.inputSchema === void 0) {
                const err9 = { instancePath: instancePath + "/tools/" + i1, schemaPath: "#/allOf/1/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "inputSchema" }, message: "must have required property 'inputSchema'" };
                if (vErrors === null) {
                  vErrors = [err9];
                } else {
                  vErrors.push(err9);
                }
                errors++;
              }
              if (data6.outputSchema === void 0) {
                const err10 = { instancePath: instancePath + "/tools/" + i1, schemaPath: "#/allOf/1/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "outputSchema" }, message: "must have required property 'outputSchema'" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
              }
              if (data6.name !== void 0) {
                let data7 = data6.name;
                if (!(data7 === "onStart" || data7 === "beforeModel" || data7 === "afterModel" || data7 === "beforeTool" || data7 === "afterTool" || data7 === "onFinish" || data7 === "onError")) {
                  const err11 = { instancePath: instancePath + "/tools/" + i1 + "/name", schemaPath: "#/allOf/1/then/properties/tools/items/properties/name/enum", keyword: "enum", params: { allowedValues: schema122.allOf[1].then.properties.tools.items.properties.name.enum }, message: "must be equal to one of the allowed values" };
                  if (vErrors === null) {
                    vErrors = [err11];
                  } else {
                    vErrors.push(err11);
                  }
                  errors++;
                }
              }
            }
          }
        }
      }
    }
    var _valid1 = _errs13 === errors;
    valid7 = _valid1;
  }
  if (!valid7) {
    const err12 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err12];
    } else {
      vErrors.push(err12);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err13 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err13];
      } else {
        vErrors.push(err13);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err14 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err14];
      } else {
        vErrors.push(err14);
      }
      errors++;
    }
    if (data.description === void 0) {
      const err15 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
      if (vErrors === null) {
        vErrors = [err15];
      } else {
        vErrors.push(err15);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err16 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err16];
      } else {
        vErrors.push(err16);
      }
      errors++;
    }
    if (data.sdkVersion === void 0) {
      const err17 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sdkVersion" }, message: "must have required property 'sdkVersion'" };
      if (vErrors === null) {
        vErrors = [err17];
      } else {
        vErrors.push(err17);
      }
      errors++;
    }
    if (data.language === void 0) {
      const err18 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "language" }, message: "must have required property 'language'" };
      if (vErrors === null) {
        vErrors = [err18];
      } else {
        vErrors.push(err18);
      }
      errors++;
    }
    if (data.entry === void 0) {
      const err19 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err19];
      } else {
        vErrors.push(err19);
      }
      errors++;
    }
    if (data.runtime === void 0) {
      const err20 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runtime" }, message: "must have required property 'runtime'" };
      if (vErrors === null) {
        vErrors = [err20];
      } else {
        vErrors.push(err20);
      }
      errors++;
    }
    if (data.source === void 0) {
      const err21 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
      if (vErrors === null) {
        vErrors = [err21];
      } else {
        vErrors.push(err21);
      }
      errors++;
    }
    if (data.kind === void 0) {
      const err22 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err22];
      } else {
        vErrors.push(err22);
      }
      errors++;
    }
    if (data.permissions === void 0) {
      const err23 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "permissions" }, message: "must have required property 'permissions'" };
      if (vErrors === null) {
        vErrors = [err23];
      } else {
        vErrors.push(err23);
      }
      errors++;
    }
    if (data.tools === void 0) {
      const err24 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tools" }, message: "must have required property 'tools'" };
      if (vErrors === null) {
        vErrors = [err24];
      } else {
        vErrors.push(err24);
      }
      errors++;
    }
    if (data.integrity === void 0) {
      const err25 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "integrity" }, message: "must have required property 'integrity'" };
      if (vErrors === null) {
        vErrors = [err25];
      } else {
        vErrors.push(err25);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema122.properties, key0)) {
        const err26 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data8 = data.id;
      if (typeof data8 === "string") {
        if (!pattern0.test(data8)) {
          const err27 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err27];
          } else {
            vErrors.push(err27);
          }
          errors++;
        }
      } else {
        const err28 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data9 = data.name;
      if (typeof data9 === "string") {
        if (func3(data9) > 120) {
          const err29 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
        if (func3(data9) < 1) {
          const err30 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
      } else {
        const err31 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    if (data.description !== void 0) {
      let data10 = data.description;
      if (typeof data10 === "string") {
        if (func3(data10) > 2e3) {
          const err32 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
      } else {
        const err33 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data11 = data.version;
      if (typeof data11 === "string") {
        if (func3(data11) > 32) {
          const err34 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
        if (func3(data11) < 1) {
          const err35 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
      } else {
        const err36 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
    }
    if (data.sdkVersion !== void 0) {
      if ("1" !== data.sdkVersion) {
        const err37 = { instancePath: instancePath + "/sdkVersion", schemaPath: "#/properties/sdkVersion/const", keyword: "const", params: { allowedValue: "1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err37];
        } else {
          vErrors.push(err37);
        }
        errors++;
      }
    }
    if (data.language !== void 0) {
      if ("typescript" !== data.language) {
        const err38 = { instancePath: instancePath + "/language", schemaPath: "#/properties/language/const", keyword: "const", params: { allowedValue: "typescript" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
    }
    if (data.entry !== void 0) {
      if ("dist/index.js" !== data.entry) {
        const err39 = { instancePath: instancePath + "/entry", schemaPath: "#/properties/entry/const", keyword: "const", params: { allowedValue: "dist/index.js" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.runtime !== void 0) {
      if ("runtime" !== data.runtime) {
        const err40 = { instancePath: instancePath + "/runtime", schemaPath: "#/properties/runtime/const", keyword: "const", params: { allowedValue: "runtime" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err40];
        } else {
          vErrors.push(err40);
        }
        errors++;
      }
    }
    if (data.source !== void 0) {
      if ("custom" !== data.source) {
        const err41 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/const", keyword: "const", params: { allowedValue: "custom" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err41];
        } else {
          vErrors.push(err41);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      let data17 = data.kind;
      if (!(data17 === "plugin" || data17 === "code" || data17 === "workspace-hook")) {
        const err42 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema122.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err42];
        } else {
          vErrors.push(err42);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data18 = data.author;
      if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
        if (data18.name === void 0) {
          const err43 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
        for (const key1 in data18) {
          if (!(key1 === "name" || key1 === "url")) {
            const err44 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err44];
            } else {
              vErrors.push(err44);
            }
            errors++;
          }
        }
        if (data18.name !== void 0) {
          let data19 = data18.name;
          if (typeof data19 === "string") {
            if (func3(data19) > 120) {
              const err45 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err45];
              } else {
                vErrors.push(err45);
              }
              errors++;
            }
            if (func3(data19) < 1) {
              const err46 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err46];
              } else {
                vErrors.push(err46);
              }
              errors++;
            }
          } else {
            const err47 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err47];
            } else {
              vErrors.push(err47);
            }
            errors++;
          }
        }
        if (data18.url !== void 0) {
          let data20 = data18.url;
          if (typeof data20 === "string") {
            if (func3(data20) > 2048) {
              const err48 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
            if (!pattern67.test(data20)) {
              const err49 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
              if (vErrors === null) {
                vErrors = [err49];
              } else {
                vErrors.push(err49);
              }
              errors++;
            }
          } else {
            const err50 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err50];
            } else {
              vErrors.push(err50);
            }
            errors++;
          }
        }
      } else {
        const err51 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err51];
        } else {
          vErrors.push(err51);
        }
        errors++;
      }
    }
    if (data.license !== void 0) {
      let data21 = data.license;
      if (typeof data21 === "string") {
        if (func3(data21) > 64) {
          const err52 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
        if (func3(data21) < 1) {
          const err53 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
      } else {
        const err54 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err54];
        } else {
          vErrors.push(err54);
        }
        errors++;
      }
    }
    if (data.homepage !== void 0) {
      let data22 = data.homepage;
      if (typeof data22 === "string") {
        if (func3(data22) > 2048) {
          const err55 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
        if (!pattern67.test(data22)) {
          const err56 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
      } else {
        const err57 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err57];
        } else {
          vErrors.push(err57);
        }
        errors++;
      }
    }
    if (data.permissions !== void 0) {
      let data23 = data.permissions;
      if (Array.isArray(data23)) {
        if (data23.length > 64) {
          const err58 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
        const len2 = data23.length;
        for (let i2 = 0; i2 < len2; i2++) {
          let data24 = data23[i2];
          if (typeof data24 === "string") {
            if (!pattern69.test(data24)) {
              const err59 = { instancePath: instancePath + "/permissions/" + i2, schemaPath: "#/definitions/permission/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err59];
              } else {
                vErrors.push(err59);
              }
              errors++;
            }
          } else {
            const err60 = { instancePath: instancePath + "/permissions/" + i2, schemaPath: "#/definitions/permission/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
        }
        let i3 = data23.length;
        let j0;
        if (i3 > 1) {
          outer0: for (; i3--; ) {
            for (j0 = i3; j0--; ) {
              if (func0(data23[i3], data23[j0])) {
                const err61 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i3, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i3 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err61];
                } else {
                  vErrors.push(err61);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err62 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err62];
        } else {
          vErrors.push(err62);
        }
        errors++;
      }
    }
    if (data.tools !== void 0) {
      let data25 = data.tools;
      if (Array.isArray(data25)) {
        if (data25.length > 32) {
          const err63 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err63];
          } else {
            vErrors.push(err63);
          }
          errors++;
        }
        if (data25.length < 1) {
          const err64 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
        const len3 = data25.length;
        for (let i4 = 0; i4 < len3; i4++) {
          let data26 = data25[i4];
          if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
            if (data26.name === void 0) {
              const err65 = { instancePath: instancePath + "/tools/" + i4, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err65];
              } else {
                vErrors.push(err65);
              }
              errors++;
            }
            if (data26.description === void 0) {
              const err66 = { instancePath: instancePath + "/tools/" + i4, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
            if (data26.permissions === void 0) {
              const err67 = { instancePath: instancePath + "/tools/" + i4, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "permissions" }, message: "must have required property 'permissions'" };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
            for (const key2 in data26) {
              if (!(key2 === "name" || key2 === "description" || key2 === "inputSchema" || key2 === "outputSchema" || key2 === "permissions")) {
                const err68 = { instancePath: instancePath + "/tools/" + i4, schemaPath: "#/properties/tools/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err68];
                } else {
                  vErrors.push(err68);
                }
                errors++;
              }
            }
            if (data26.name !== void 0) {
              let data27 = data26.name;
              if (typeof data27 === "string") {
                if (!pattern70.test(data27)) {
                  const err69 = { instancePath: instancePath + "/tools/" + i4 + "/name", schemaPath: "#/properties/tools/items/properties/name/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_-]{0,47}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_-]{0,47}$"' };
                  if (vErrors === null) {
                    vErrors = [err69];
                  } else {
                    vErrors.push(err69);
                  }
                  errors++;
                }
              } else {
                const err70 = { instancePath: instancePath + "/tools/" + i4 + "/name", schemaPath: "#/properties/tools/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err70];
                } else {
                  vErrors.push(err70);
                }
                errors++;
              }
            }
            if (data26.description !== void 0) {
              let data28 = data26.description;
              if (typeof data28 === "string") {
                if (func3(data28) > 500) {
                  const err71 = { instancePath: instancePath + "/tools/" + i4 + "/description", schemaPath: "#/properties/tools/items/properties/description/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                  if (vErrors === null) {
                    vErrors = [err71];
                  } else {
                    vErrors.push(err71);
                  }
                  errors++;
                }
                if (func3(data28) < 1) {
                  const err72 = { instancePath: instancePath + "/tools/" + i4 + "/description", schemaPath: "#/properties/tools/items/properties/description/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err72];
                  } else {
                    vErrors.push(err72);
                  }
                  errors++;
                }
              } else {
                const err73 = { instancePath: instancePath + "/tools/" + i4 + "/description", schemaPath: "#/properties/tools/items/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err73];
                } else {
                  vErrors.push(err73);
                }
                errors++;
              }
            }
            if (data26.inputSchema !== void 0) {
              let data29 = data26.inputSchema;
              if (!(data29 && typeof data29 == "object" && !Array.isArray(data29))) {
                const err74 = { instancePath: instancePath + "/tools/" + i4 + "/inputSchema", schemaPath: "#/properties/tools/items/properties/inputSchema/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err74];
                } else {
                  vErrors.push(err74);
                }
                errors++;
              }
            }
            if (data26.outputSchema !== void 0) {
              let data30 = data26.outputSchema;
              if (!(data30 && typeof data30 == "object" && !Array.isArray(data30))) {
                const err75 = { instancePath: instancePath + "/tools/" + i4 + "/outputSchema", schemaPath: "#/properties/tools/items/properties/outputSchema/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err75];
                } else {
                  vErrors.push(err75);
                }
                errors++;
              }
            }
            if (data26.permissions !== void 0) {
              let data31 = data26.permissions;
              if (Array.isArray(data31)) {
                if (data31.length > 64) {
                  const err76 = { instancePath: instancePath + "/tools/" + i4 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
                  if (vErrors === null) {
                    vErrors = [err76];
                  } else {
                    vErrors.push(err76);
                  }
                  errors++;
                }
                const len4 = data31.length;
                for (let i5 = 0; i5 < len4; i5++) {
                  let data32 = data31[i5];
                  if (typeof data32 === "string") {
                    if (!pattern69.test(data32)) {
                      const err77 = { instancePath: instancePath + "/tools/" + i4 + "/permissions/" + i5, schemaPath: "#/definitions/permission/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$"' };
                      if (vErrors === null) {
                        vErrors = [err77];
                      } else {
                        vErrors.push(err77);
                      }
                      errors++;
                    }
                  } else {
                    const err78 = { instancePath: instancePath + "/tools/" + i4 + "/permissions/" + i5, schemaPath: "#/definitions/permission/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err78];
                    } else {
                      vErrors.push(err78);
                    }
                    errors++;
                  }
                }
                let i6 = data31.length;
                let j1;
                if (i6 > 1) {
                  outer1: for (; i6--; ) {
                    for (j1 = i6; j1--; ) {
                      if (func0(data31[i6], data31[j1])) {
                        const err79 = { instancePath: instancePath + "/tools/" + i4 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i6, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i6 + " are identical)" };
                        if (vErrors === null) {
                          vErrors = [err79];
                        } else {
                          vErrors.push(err79);
                        }
                        errors++;
                        break outer1;
                      }
                    }
                  }
                }
              } else {
                const err80 = { instancePath: instancePath + "/tools/" + i4 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                if (vErrors === null) {
                  vErrors = [err80];
                } else {
                  vErrors.push(err80);
                }
                errors++;
              }
            }
          } else {
            const err81 = { instancePath: instancePath + "/tools/" + i4, schemaPath: "#/properties/tools/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err81];
            } else {
              vErrors.push(err81);
            }
            errors++;
          }
        }
      } else {
        const err82 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err82];
        } else {
          vErrors.push(err82);
        }
        errors++;
      }
    }
    if (data.limits !== void 0) {
      let data33 = data.limits;
      if (data33 && typeof data33 == "object" && !Array.isArray(data33)) {
        for (const key3 in data33) {
          if (!(key3 === "timeoutMs" || key3 === "maxOutputBytes" || key3 === "maxConcurrency")) {
            const err83 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err83];
            } else {
              vErrors.push(err83);
            }
            errors++;
          }
        }
        if (data33.timeoutMs !== void 0) {
          let data34 = data33.timeoutMs;
          if (!(typeof data34 == "number" && (!(data34 % 1) && !isNaN(data34)) && isFinite(data34))) {
            const err84 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err84];
            } else {
              vErrors.push(err84);
            }
            errors++;
          }
          if (typeof data34 == "number" && isFinite(data34)) {
            if (data34 > 12e4 || isNaN(data34)) {
              const err85 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 12e4 }, message: "must be <= 120000" };
              if (vErrors === null) {
                vErrors = [err85];
              } else {
                vErrors.push(err85);
              }
              errors++;
            }
            if (data34 < 100 || isNaN(data34)) {
              const err86 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
              if (vErrors === null) {
                vErrors = [err86];
              } else {
                vErrors.push(err86);
              }
              errors++;
            }
          }
        }
        if (data33.maxOutputBytes !== void 0) {
          let data35 = data33.maxOutputBytes;
          if (!(typeof data35 == "number" && (!(data35 % 1) && !isNaN(data35)) && isFinite(data35))) {
            const err87 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err87];
            } else {
              vErrors.push(err87);
            }
            errors++;
          }
          if (typeof data35 == "number" && isFinite(data35)) {
            if (data35 > 1048576 || isNaN(data35)) {
              const err88 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1048576 }, message: "must be <= 1048576" };
              if (vErrors === null) {
                vErrors = [err88];
              } else {
                vErrors.push(err88);
              }
              errors++;
            }
            if (data35 < 1024 || isNaN(data35)) {
              const err89 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1024 }, message: "must be >= 1024" };
              if (vErrors === null) {
                vErrors = [err89];
              } else {
                vErrors.push(err89);
              }
              errors++;
            }
          }
        }
        if (data33.maxConcurrency !== void 0) {
          let data36 = data33.maxConcurrency;
          if (!(typeof data36 == "number" && (!(data36 % 1) && !isNaN(data36)) && isFinite(data36))) {
            const err90 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err90];
            } else {
              vErrors.push(err90);
            }
            errors++;
          }
          if (typeof data36 == "number" && isFinite(data36)) {
            if (data36 > 16 || isNaN(data36)) {
              const err91 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/maximum", keyword: "maximum", params: { comparison: "<=", limit: 16 }, message: "must be <= 16" };
              if (vErrors === null) {
                vErrors = [err91];
              } else {
                vErrors.push(err91);
              }
              errors++;
            }
            if (data36 < 1 || isNaN(data36)) {
              const err92 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err92];
              } else {
                vErrors.push(err92);
              }
              errors++;
            }
          }
        }
      } else {
        const err93 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err93];
        } else {
          vErrors.push(err93);
        }
        errors++;
      }
    }
    if (data.integrity !== void 0) {
      let data37 = data.integrity;
      if (typeof data37 === "string") {
        if (func3(data37) > 128) {
          const err94 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err94];
          } else {
            vErrors.push(err94);
          }
          errors++;
        }
        if (!pattern80.test(data37)) {
          const err95 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/pattern", keyword: "pattern", params: { pattern: "^sha256-[A-Za-z0-9+/]{43}=$" }, message: 'must match pattern "^sha256-[A-Za-z0-9+/]{43}=$"' };
          if (vErrors === null) {
            vErrors = [err95];
          } else {
            vErrors.push(err95);
          }
          errors++;
        }
      } else {
        const err96 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err96];
        } else {
          vErrors.push(err96);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data38 = data.signature;
      if (data38 && typeof data38 == "object" && !Array.isArray(data38)) {
        if (data38.algorithm === void 0) {
          const err97 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
          if (vErrors === null) {
            vErrors = [err97];
          } else {
            vErrors.push(err97);
          }
          errors++;
        }
        if (data38.keyId === void 0) {
          const err98 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "keyId" }, message: "must have required property 'keyId'" };
          if (vErrors === null) {
            vErrors = [err98];
          } else {
            vErrors.push(err98);
          }
          errors++;
        }
        if (data38.value === void 0) {
          const err99 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
          if (vErrors === null) {
            vErrors = [err99];
          } else {
            vErrors.push(err99);
          }
          errors++;
        }
        for (const key4 in data38) {
          if (!(key4 === "algorithm" || key4 === "keyId" || key4 === "value")) {
            const err100 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err100];
            } else {
              vErrors.push(err100);
            }
            errors++;
          }
        }
        if (data38.algorithm !== void 0) {
          if ("Ed25519" !== data38.algorithm) {
            const err101 = { instancePath: instancePath + "/signature/algorithm", schemaPath: "#/properties/signature/properties/algorithm/const", keyword: "const", params: { allowedValue: "Ed25519" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err101];
            } else {
              vErrors.push(err101);
            }
            errors++;
          }
        }
        if (data38.keyId !== void 0) {
          let data40 = data38.keyId;
          if (typeof data40 === "string") {
            if (func3(data40) > 128) {
              const err102 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err102];
              } else {
                vErrors.push(err102);
              }
              errors++;
            }
            if (func3(data40) < 1) {
              const err103 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err103];
              } else {
                vErrors.push(err103);
              }
              errors++;
            }
          } else {
            const err104 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err104];
            } else {
              vErrors.push(err104);
            }
            errors++;
          }
        }
        if (data38.value !== void 0) {
          let data41 = data38.value;
          if (typeof data41 === "string") {
            if (func3(data41) > 256) {
              const err105 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
              if (vErrors === null) {
                vErrors = [err105];
              } else {
                vErrors.push(err105);
              }
              errors++;
            }
            if (func3(data41) < 40) {
              const err106 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/minLength", keyword: "minLength", params: { limit: 40 }, message: "must NOT have fewer than 40 characters" };
              if (vErrors === null) {
                vErrors = [err106];
              } else {
                vErrors.push(err106);
              }
              errors++;
            }
          } else {
            const err107 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err107];
            } else {
              vErrors.push(err107);
            }
            errors++;
          }
        }
      } else {
        const err108 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err108];
        } else {
          vErrors.push(err108);
        }
        errors++;
      }
    }
  } else {
    const err109 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err109];
    } else {
      vErrors.push(err109);
    }
    errors++;
  }
  validate66.errors = vErrors;
  return errors === 0;
}
var pluginV7 = validate67;
function validate67(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (!validate66(data, { instancePath, parentData, parentDataProperty, rootData })) {
    vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
    errors = vErrors.length;
  }
  validate67.errors = vErrors;
  return errors === 0;
}
var pluginBeta1 = validate69;
var schema127 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/beta-one/plugin.schema.json", "title": "AgComm .ai Runtime bundle manifest Beta 1", "type": "object", "required": ["id", "name", "description", "version", "sdkVersion", "language", "entry", "runtime", "source", "kind", "permissions", "tools", "integrity"], "properties": { "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "description": { "type": "string", "maxLength": 2e3 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "sdkVersion": { "const": "1" }, "language": { "const": "typescript" }, "entry": { "const": "dist/index.js" }, "runtime": { "const": "runtime" }, "source": { "const": "custom" }, "kind": { "enum": ["plugin", "code", "workspace-hook", "flow-hook"] }, "author": { "type": "object", "required": ["name"], "additionalProperties": false, "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "url": { "type": "string", "pattern": "^https://", "maxLength": 2048 } } }, "license": { "type": "string", "minLength": 1, "maxLength": 64 }, "homepage": { "type": "string", "pattern": "^https://", "maxLength": 2048 }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "$ref": "#/definitions/permission" } }, "tools": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "object", "required": ["name", "description", "permissions"], "additionalProperties": false, "properties": { "name": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,47}$" }, "description": { "type": "string", "minLength": 1, "maxLength": 500 }, "inputSchema": { "type": "object" }, "outputSchema": { "type": "object" }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "$ref": "#/definitions/permission" } } } } }, "limits": { "type": "object", "additionalProperties": false, "properties": { "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 12e4 }, "maxOutputBytes": { "type": "integer", "minimum": 1024, "maximum": 1048576 }, "maxConcurrency": { "type": "integer", "minimum": 1, "maximum": 16 } } }, "integrity": { "type": "string", "pattern": "^sha256-[A-Za-z0-9+/]{43}=$", "maxLength": 128 }, "signature": { "type": "object", "required": ["algorithm", "keyId", "value"], "additionalProperties": false, "properties": { "algorithm": { "const": "Ed25519" }, "keyId": { "type": "string", "minLength": 1, "maxLength": 128 }, "value": { "type": "string", "minLength": 40, "maxLength": 256 } } } }, "additionalProperties": false, "allOf": [{ "if": { "properties": { "kind": { "const": "code" } } }, "then": { "properties": { "tools": { "minItems": 1, "maxItems": 1, "items": { "properties": { "name": { "const": "run" } }, "required": ["inputSchema", "outputSchema"] } } } } }, { "if": { "properties": { "kind": { "const": "workspace-hook" } } }, "then": { "properties": { "tools": { "maxItems": 7, "items": { "properties": { "name": { "enum": ["onStart", "beforeModel", "afterModel", "beforeTool", "afterTool", "onFinish", "onError"] } }, "required": ["inputSchema", "outputSchema"] } } } } }, { "if": { "properties": { "kind": { "const": "flow-hook" } } }, "then": { "properties": { "tools": { "maxItems": 3, "items": { "properties": { "name": { "enum": ["beforeNode", "afterNode", "onNodeError"] } }, "required": ["inputSchema", "outputSchema"] } } } } }], "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, "permission": { "type": "string", "pattern": "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" } } };
function validate69(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind !== void 0) {
      if ("code" !== data.kind) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.tools !== void 0) {
        let data1 = data.tools;
        if (Array.isArray(data1)) {
          if (data1.length > 1) {
            const err1 = { instancePath: instancePath + "/tools", schemaPath: "#/allOf/0/then/properties/tools/maxItems", keyword: "maxItems", params: { limit: 1 }, message: "must NOT have more than 1 items" };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
          if (data1.length < 1) {
            const err2 = { instancePath: instancePath + "/tools", schemaPath: "#/allOf/0/then/properties/tools/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
          const len0 = data1.length;
          for (let i0 = 0; i0 < len0; i0++) {
            let data2 = data1[i0];
            if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
              if (data2.inputSchema === void 0) {
                const err3 = { instancePath: instancePath + "/tools/" + i0, schemaPath: "#/allOf/0/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "inputSchema" }, message: "must have required property 'inputSchema'" };
                if (vErrors === null) {
                  vErrors = [err3];
                } else {
                  vErrors.push(err3);
                }
                errors++;
              }
              if (data2.outputSchema === void 0) {
                const err4 = { instancePath: instancePath + "/tools/" + i0, schemaPath: "#/allOf/0/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "outputSchema" }, message: "must have required property 'outputSchema'" };
                if (vErrors === null) {
                  vErrors = [err4];
                } else {
                  vErrors.push(err4);
                }
                errors++;
              }
              if (data2.name !== void 0) {
                if ("run" !== data2.name) {
                  const err5 = { instancePath: instancePath + "/tools/" + i0 + "/name", schemaPath: "#/allOf/0/then/properties/tools/items/properties/name/const", keyword: "const", params: { allowedValue: "run" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err5];
                  } else {
                    vErrors.push(err5);
                  }
                  errors++;
                }
              }
            }
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err6 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err6];
    } else {
      vErrors.push(err6);
    }
    errors++;
  }
  const _errs10 = errors;
  let valid7 = true;
  const _errs11 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind !== void 0) {
      if ("workspace-hook" !== data.kind) {
        const err7 = {};
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
  }
  var _valid1 = _errs11 === errors;
  errors = _errs10;
  if (vErrors !== null) {
    if (_errs10) {
      vErrors.length = _errs10;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs13 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.tools !== void 0) {
        let data5 = data.tools;
        if (Array.isArray(data5)) {
          if (data5.length > 7) {
            const err8 = { instancePath: instancePath + "/tools", schemaPath: "#/allOf/1/then/properties/tools/maxItems", keyword: "maxItems", params: { limit: 7 }, message: "must NOT have more than 7 items" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
          const len1 = data5.length;
          for (let i1 = 0; i1 < len1; i1++) {
            let data6 = data5[i1];
            if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
              if (data6.inputSchema === void 0) {
                const err9 = { instancePath: instancePath + "/tools/" + i1, schemaPath: "#/allOf/1/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "inputSchema" }, message: "must have required property 'inputSchema'" };
                if (vErrors === null) {
                  vErrors = [err9];
                } else {
                  vErrors.push(err9);
                }
                errors++;
              }
              if (data6.outputSchema === void 0) {
                const err10 = { instancePath: instancePath + "/tools/" + i1, schemaPath: "#/allOf/1/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "outputSchema" }, message: "must have required property 'outputSchema'" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
              }
              if (data6.name !== void 0) {
                let data7 = data6.name;
                if (!(data7 === "onStart" || data7 === "beforeModel" || data7 === "afterModel" || data7 === "beforeTool" || data7 === "afterTool" || data7 === "onFinish" || data7 === "onError")) {
                  const err11 = { instancePath: instancePath + "/tools/" + i1 + "/name", schemaPath: "#/allOf/1/then/properties/tools/items/properties/name/enum", keyword: "enum", params: { allowedValues: schema127.allOf[1].then.properties.tools.items.properties.name.enum }, message: "must be equal to one of the allowed values" };
                  if (vErrors === null) {
                    vErrors = [err11];
                  } else {
                    vErrors.push(err11);
                  }
                  errors++;
                }
              }
            }
          }
        }
      }
    }
    var _valid1 = _errs13 === errors;
    valid7 = _valid1;
  }
  if (!valid7) {
    const err12 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err12];
    } else {
      vErrors.push(err12);
    }
    errors++;
  }
  const _errs18 = errors;
  let valid13 = true;
  const _errs19 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind !== void 0) {
      if ("flow-hook" !== data.kind) {
        const err13 = {};
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  }
  var _valid2 = _errs19 === errors;
  errors = _errs18;
  if (vErrors !== null) {
    if (_errs18) {
      vErrors.length = _errs18;
    } else {
      vErrors = null;
    }
  }
  if (_valid2) {
    const _errs21 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.tools !== void 0) {
        let data9 = data.tools;
        if (Array.isArray(data9)) {
          if (data9.length > 3) {
            const err14 = { instancePath: instancePath + "/tools", schemaPath: "#/allOf/2/then/properties/tools/maxItems", keyword: "maxItems", params: { limit: 3 }, message: "must NOT have more than 3 items" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
          const len2 = data9.length;
          for (let i2 = 0; i2 < len2; i2++) {
            let data10 = data9[i2];
            if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
              if (data10.inputSchema === void 0) {
                const err15 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/allOf/2/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "inputSchema" }, message: "must have required property 'inputSchema'" };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
              if (data10.outputSchema === void 0) {
                const err16 = { instancePath: instancePath + "/tools/" + i2, schemaPath: "#/allOf/2/then/properties/tools/items/required", keyword: "required", params: { missingProperty: "outputSchema" }, message: "must have required property 'outputSchema'" };
                if (vErrors === null) {
                  vErrors = [err16];
                } else {
                  vErrors.push(err16);
                }
                errors++;
              }
              if (data10.name !== void 0) {
                let data11 = data10.name;
                if (!(data11 === "beforeNode" || data11 === "afterNode" || data11 === "onNodeError")) {
                  const err17 = { instancePath: instancePath + "/tools/" + i2 + "/name", schemaPath: "#/allOf/2/then/properties/tools/items/properties/name/enum", keyword: "enum", params: { allowedValues: schema127.allOf[2].then.properties.tools.items.properties.name.enum }, message: "must be equal to one of the allowed values" };
                  if (vErrors === null) {
                    vErrors = [err17];
                  } else {
                    vErrors.push(err17);
                  }
                  errors++;
                }
              }
            }
          }
        }
      }
    }
    var _valid2 = _errs21 === errors;
    valid13 = _valid2;
  }
  if (!valid13) {
    const err18 = { instancePath, schemaPath: "#/allOf/2/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err19 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err19];
      } else {
        vErrors.push(err19);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err20 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err20];
      } else {
        vErrors.push(err20);
      }
      errors++;
    }
    if (data.description === void 0) {
      const err21 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
      if (vErrors === null) {
        vErrors = [err21];
      } else {
        vErrors.push(err21);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err22 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err22];
      } else {
        vErrors.push(err22);
      }
      errors++;
    }
    if (data.sdkVersion === void 0) {
      const err23 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sdkVersion" }, message: "must have required property 'sdkVersion'" };
      if (vErrors === null) {
        vErrors = [err23];
      } else {
        vErrors.push(err23);
      }
      errors++;
    }
    if (data.language === void 0) {
      const err24 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "language" }, message: "must have required property 'language'" };
      if (vErrors === null) {
        vErrors = [err24];
      } else {
        vErrors.push(err24);
      }
      errors++;
    }
    if (data.entry === void 0) {
      const err25 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err25];
      } else {
        vErrors.push(err25);
      }
      errors++;
    }
    if (data.runtime === void 0) {
      const err26 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runtime" }, message: "must have required property 'runtime'" };
      if (vErrors === null) {
        vErrors = [err26];
      } else {
        vErrors.push(err26);
      }
      errors++;
    }
    if (data.source === void 0) {
      const err27 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
      if (vErrors === null) {
        vErrors = [err27];
      } else {
        vErrors.push(err27);
      }
      errors++;
    }
    if (data.kind === void 0) {
      const err28 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err28];
      } else {
        vErrors.push(err28);
      }
      errors++;
    }
    if (data.permissions === void 0) {
      const err29 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "permissions" }, message: "must have required property 'permissions'" };
      if (vErrors === null) {
        vErrors = [err29];
      } else {
        vErrors.push(err29);
      }
      errors++;
    }
    if (data.tools === void 0) {
      const err30 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tools" }, message: "must have required property 'tools'" };
      if (vErrors === null) {
        vErrors = [err30];
      } else {
        vErrors.push(err30);
      }
      errors++;
    }
    if (data.integrity === void 0) {
      const err31 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "integrity" }, message: "must have required property 'integrity'" };
      if (vErrors === null) {
        vErrors = [err31];
      } else {
        vErrors.push(err31);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func2.call(schema127.properties, key0)) {
        const err32 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err32];
        } else {
          vErrors.push(err32);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data12 = data.id;
      if (typeof data12 === "string") {
        if (!pattern0.test(data12)) {
          const err33 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err33];
          } else {
            vErrors.push(err33);
          }
          errors++;
        }
      } else {
        const err34 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data13 = data.name;
      if (typeof data13 === "string") {
        if (func3(data13) > 120) {
          const err35 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
        if (func3(data13) < 1) {
          const err36 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
      } else {
        const err37 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err37];
        } else {
          vErrors.push(err37);
        }
        errors++;
      }
    }
    if (data.description !== void 0) {
      let data14 = data.description;
      if (typeof data14 === "string") {
        if (func3(data14) > 2e3) {
          const err38 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
      } else {
        const err39 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      let data15 = data.version;
      if (typeof data15 === "string") {
        if (func3(data15) > 32) {
          const err40 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        if (func3(data15) < 1) {
          const err41 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
      } else {
        const err42 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err42];
        } else {
          vErrors.push(err42);
        }
        errors++;
      }
    }
    if (data.sdkVersion !== void 0) {
      if ("1" !== data.sdkVersion) {
        const err43 = { instancePath: instancePath + "/sdkVersion", schemaPath: "#/properties/sdkVersion/const", keyword: "const", params: { allowedValue: "1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err43];
        } else {
          vErrors.push(err43);
        }
        errors++;
      }
    }
    if (data.language !== void 0) {
      if ("typescript" !== data.language) {
        const err44 = { instancePath: instancePath + "/language", schemaPath: "#/properties/language/const", keyword: "const", params: { allowedValue: "typescript" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err44];
        } else {
          vErrors.push(err44);
        }
        errors++;
      }
    }
    if (data.entry !== void 0) {
      if ("dist/index.js" !== data.entry) {
        const err45 = { instancePath: instancePath + "/entry", schemaPath: "#/properties/entry/const", keyword: "const", params: { allowedValue: "dist/index.js" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err45];
        } else {
          vErrors.push(err45);
        }
        errors++;
      }
    }
    if (data.runtime !== void 0) {
      if ("runtime" !== data.runtime) {
        const err46 = { instancePath: instancePath + "/runtime", schemaPath: "#/properties/runtime/const", keyword: "const", params: { allowedValue: "runtime" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err46];
        } else {
          vErrors.push(err46);
        }
        errors++;
      }
    }
    if (data.source !== void 0) {
      if ("custom" !== data.source) {
        const err47 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/const", keyword: "const", params: { allowedValue: "custom" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err47];
        } else {
          vErrors.push(err47);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      let data21 = data.kind;
      if (!(data21 === "plugin" || data21 === "code" || data21 === "workspace-hook" || data21 === "flow-hook")) {
        const err48 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema127.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err48];
        } else {
          vErrors.push(err48);
        }
        errors++;
      }
    }
    if (data.author !== void 0) {
      let data22 = data.author;
      if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
        if (data22.name === void 0) {
          const err49 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          if (vErrors === null) {
            vErrors = [err49];
          } else {
            vErrors.push(err49);
          }
          errors++;
        }
        for (const key1 in data22) {
          if (!(key1 === "name" || key1 === "url")) {
            const err50 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err50];
            } else {
              vErrors.push(err50);
            }
            errors++;
          }
        }
        if (data22.name !== void 0) {
          let data23 = data22.name;
          if (typeof data23 === "string") {
            if (func3(data23) > 120) {
              const err51 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
              if (vErrors === null) {
                vErrors = [err51];
              } else {
                vErrors.push(err51);
              }
              errors++;
            }
            if (func3(data23) < 1) {
              const err52 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err52];
              } else {
                vErrors.push(err52);
              }
              errors++;
            }
          } else {
            const err53 = { instancePath: instancePath + "/author/name", schemaPath: "#/properties/author/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err53];
            } else {
              vErrors.push(err53);
            }
            errors++;
          }
        }
        if (data22.url !== void 0) {
          let data24 = data22.url;
          if (typeof data24 === "string") {
            if (func3(data24) > 2048) {
              const err54 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
              if (vErrors === null) {
                vErrors = [err54];
              } else {
                vErrors.push(err54);
              }
              errors++;
            }
            if (!pattern67.test(data24)) {
              const err55 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
              if (vErrors === null) {
                vErrors = [err55];
              } else {
                vErrors.push(err55);
              }
              errors++;
            }
          } else {
            const err56 = { instancePath: instancePath + "/author/url", schemaPath: "#/properties/author/properties/url/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err56];
            } else {
              vErrors.push(err56);
            }
            errors++;
          }
        }
      } else {
        const err57 = { instancePath: instancePath + "/author", schemaPath: "#/properties/author/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err57];
        } else {
          vErrors.push(err57);
        }
        errors++;
      }
    }
    if (data.license !== void 0) {
      let data25 = data.license;
      if (typeof data25 === "string") {
        if (func3(data25) > 64) {
          const err58 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
        if (func3(data25) < 1) {
          const err59 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err59];
          } else {
            vErrors.push(err59);
          }
          errors++;
        }
      } else {
        const err60 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err60];
        } else {
          vErrors.push(err60);
        }
        errors++;
      }
    }
    if (data.homepage !== void 0) {
      let data26 = data.homepage;
      if (typeof data26 === "string") {
        if (func3(data26) > 2048) {
          const err61 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
          if (vErrors === null) {
            vErrors = [err61];
          } else {
            vErrors.push(err61);
          }
          errors++;
        }
        if (!pattern67.test(data26)) {
          const err62 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
          if (vErrors === null) {
            vErrors = [err62];
          } else {
            vErrors.push(err62);
          }
          errors++;
        }
      } else {
        const err63 = { instancePath: instancePath + "/homepage", schemaPath: "#/properties/homepage/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err63];
        } else {
          vErrors.push(err63);
        }
        errors++;
      }
    }
    if (data.permissions !== void 0) {
      let data27 = data.permissions;
      if (Array.isArray(data27)) {
        if (data27.length > 64) {
          const err64 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
        const len3 = data27.length;
        for (let i3 = 0; i3 < len3; i3++) {
          let data28 = data27[i3];
          if (typeof data28 === "string") {
            if (!pattern69.test(data28)) {
              const err65 = { instancePath: instancePath + "/permissions/" + i3, schemaPath: "#/definitions/permission/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$"' };
              if (vErrors === null) {
                vErrors = [err65];
              } else {
                vErrors.push(err65);
              }
              errors++;
            }
          } else {
            const err66 = { instancePath: instancePath + "/permissions/" + i3, schemaPath: "#/definitions/permission/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err66];
            } else {
              vErrors.push(err66);
            }
            errors++;
          }
        }
        let i4 = data27.length;
        let j0;
        if (i4 > 1) {
          outer0: for (; i4--; ) {
            for (j0 = i4; j0--; ) {
              if (func0(data27[i4], data27[j0])) {
                const err67 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i4 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err67];
                } else {
                  vErrors.push(err67);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err68 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err68];
        } else {
          vErrors.push(err68);
        }
        errors++;
      }
    }
    if (data.tools !== void 0) {
      let data29 = data.tools;
      if (Array.isArray(data29)) {
        if (data29.length > 32) {
          const err69 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err69];
          } else {
            vErrors.push(err69);
          }
          errors++;
        }
        if (data29.length < 1) {
          const err70 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err70];
          } else {
            vErrors.push(err70);
          }
          errors++;
        }
        const len4 = data29.length;
        for (let i5 = 0; i5 < len4; i5++) {
          let data30 = data29[i5];
          if (data30 && typeof data30 == "object" && !Array.isArray(data30)) {
            if (data30.name === void 0) {
              const err71 = { instancePath: instancePath + "/tools/" + i5, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err71];
              } else {
                vErrors.push(err71);
              }
              errors++;
            }
            if (data30.description === void 0) {
              const err72 = { instancePath: instancePath + "/tools/" + i5, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
              if (vErrors === null) {
                vErrors = [err72];
              } else {
                vErrors.push(err72);
              }
              errors++;
            }
            if (data30.permissions === void 0) {
              const err73 = { instancePath: instancePath + "/tools/" + i5, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "permissions" }, message: "must have required property 'permissions'" };
              if (vErrors === null) {
                vErrors = [err73];
              } else {
                vErrors.push(err73);
              }
              errors++;
            }
            for (const key2 in data30) {
              if (!(key2 === "name" || key2 === "description" || key2 === "inputSchema" || key2 === "outputSchema" || key2 === "permissions")) {
                const err74 = { instancePath: instancePath + "/tools/" + i5, schemaPath: "#/properties/tools/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err74];
                } else {
                  vErrors.push(err74);
                }
                errors++;
              }
            }
            if (data30.name !== void 0) {
              let data31 = data30.name;
              if (typeof data31 === "string") {
                if (!pattern70.test(data31)) {
                  const err75 = { instancePath: instancePath + "/tools/" + i5 + "/name", schemaPath: "#/properties/tools/items/properties/name/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_-]{0,47}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_-]{0,47}$"' };
                  if (vErrors === null) {
                    vErrors = [err75];
                  } else {
                    vErrors.push(err75);
                  }
                  errors++;
                }
              } else {
                const err76 = { instancePath: instancePath + "/tools/" + i5 + "/name", schemaPath: "#/properties/tools/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err76];
                } else {
                  vErrors.push(err76);
                }
                errors++;
              }
            }
            if (data30.description !== void 0) {
              let data32 = data30.description;
              if (typeof data32 === "string") {
                if (func3(data32) > 500) {
                  const err77 = { instancePath: instancePath + "/tools/" + i5 + "/description", schemaPath: "#/properties/tools/items/properties/description/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                  if (vErrors === null) {
                    vErrors = [err77];
                  } else {
                    vErrors.push(err77);
                  }
                  errors++;
                }
                if (func3(data32) < 1) {
                  const err78 = { instancePath: instancePath + "/tools/" + i5 + "/description", schemaPath: "#/properties/tools/items/properties/description/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err78];
                  } else {
                    vErrors.push(err78);
                  }
                  errors++;
                }
              } else {
                const err79 = { instancePath: instancePath + "/tools/" + i5 + "/description", schemaPath: "#/properties/tools/items/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err79];
                } else {
                  vErrors.push(err79);
                }
                errors++;
              }
            }
            if (data30.inputSchema !== void 0) {
              let data33 = data30.inputSchema;
              if (!(data33 && typeof data33 == "object" && !Array.isArray(data33))) {
                const err80 = { instancePath: instancePath + "/tools/" + i5 + "/inputSchema", schemaPath: "#/properties/tools/items/properties/inputSchema/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err80];
                } else {
                  vErrors.push(err80);
                }
                errors++;
              }
            }
            if (data30.outputSchema !== void 0) {
              let data34 = data30.outputSchema;
              if (!(data34 && typeof data34 == "object" && !Array.isArray(data34))) {
                const err81 = { instancePath: instancePath + "/tools/" + i5 + "/outputSchema", schemaPath: "#/properties/tools/items/properties/outputSchema/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err81];
                } else {
                  vErrors.push(err81);
                }
                errors++;
              }
            }
            if (data30.permissions !== void 0) {
              let data35 = data30.permissions;
              if (Array.isArray(data35)) {
                if (data35.length > 64) {
                  const err82 = { instancePath: instancePath + "/tools/" + i5 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
                  if (vErrors === null) {
                    vErrors = [err82];
                  } else {
                    vErrors.push(err82);
                  }
                  errors++;
                }
                const len5 = data35.length;
                for (let i6 = 0; i6 < len5; i6++) {
                  let data36 = data35[i6];
                  if (typeof data36 === "string") {
                    if (!pattern69.test(data36)) {
                      const err83 = { instancePath: instancePath + "/tools/" + i5 + "/permissions/" + i6, schemaPath: "#/definitions/permission/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$"' };
                      if (vErrors === null) {
                        vErrors = [err83];
                      } else {
                        vErrors.push(err83);
                      }
                      errors++;
                    }
                  } else {
                    const err84 = { instancePath: instancePath + "/tools/" + i5 + "/permissions/" + i6, schemaPath: "#/definitions/permission/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err84];
                    } else {
                      vErrors.push(err84);
                    }
                    errors++;
                  }
                }
                let i7 = data35.length;
                let j1;
                if (i7 > 1) {
                  outer1: for (; i7--; ) {
                    for (j1 = i7; j1--; ) {
                      if (func0(data35[i7], data35[j1])) {
                        const err85 = { instancePath: instancePath + "/tools/" + i5 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i7, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i7 + " are identical)" };
                        if (vErrors === null) {
                          vErrors = [err85];
                        } else {
                          vErrors.push(err85);
                        }
                        errors++;
                        break outer1;
                      }
                    }
                  }
                }
              } else {
                const err86 = { instancePath: instancePath + "/tools/" + i5 + "/permissions", schemaPath: "#/properties/tools/items/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                if (vErrors === null) {
                  vErrors = [err86];
                } else {
                  vErrors.push(err86);
                }
                errors++;
              }
            }
          } else {
            const err87 = { instancePath: instancePath + "/tools/" + i5, schemaPath: "#/properties/tools/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err87];
            } else {
              vErrors.push(err87);
            }
            errors++;
          }
        }
      } else {
        const err88 = { instancePath: instancePath + "/tools", schemaPath: "#/properties/tools/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err88];
        } else {
          vErrors.push(err88);
        }
        errors++;
      }
    }
    if (data.limits !== void 0) {
      let data37 = data.limits;
      if (data37 && typeof data37 == "object" && !Array.isArray(data37)) {
        for (const key3 in data37) {
          if (!(key3 === "timeoutMs" || key3 === "maxOutputBytes" || key3 === "maxConcurrency")) {
            const err89 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err89];
            } else {
              vErrors.push(err89);
            }
            errors++;
          }
        }
        if (data37.timeoutMs !== void 0) {
          let data38 = data37.timeoutMs;
          if (!(typeof data38 == "number" && (!(data38 % 1) && !isNaN(data38)) && isFinite(data38))) {
            const err90 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err90];
            } else {
              vErrors.push(err90);
            }
            errors++;
          }
          if (typeof data38 == "number" && isFinite(data38)) {
            if (data38 > 12e4 || isNaN(data38)) {
              const err91 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 12e4 }, message: "must be <= 120000" };
              if (vErrors === null) {
                vErrors = [err91];
              } else {
                vErrors.push(err91);
              }
              errors++;
            }
            if (data38 < 100 || isNaN(data38)) {
              const err92 = { instancePath: instancePath + "/limits/timeoutMs", schemaPath: "#/properties/limits/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
              if (vErrors === null) {
                vErrors = [err92];
              } else {
                vErrors.push(err92);
              }
              errors++;
            }
          }
        }
        if (data37.maxOutputBytes !== void 0) {
          let data39 = data37.maxOutputBytes;
          if (!(typeof data39 == "number" && (!(data39 % 1) && !isNaN(data39)) && isFinite(data39))) {
            const err93 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err93];
            } else {
              vErrors.push(err93);
            }
            errors++;
          }
          if (typeof data39 == "number" && isFinite(data39)) {
            if (data39 > 1048576 || isNaN(data39)) {
              const err94 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1048576 }, message: "must be <= 1048576" };
              if (vErrors === null) {
                vErrors = [err94];
              } else {
                vErrors.push(err94);
              }
              errors++;
            }
            if (data39 < 1024 || isNaN(data39)) {
              const err95 = { instancePath: instancePath + "/limits/maxOutputBytes", schemaPath: "#/properties/limits/properties/maxOutputBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1024 }, message: "must be >= 1024" };
              if (vErrors === null) {
                vErrors = [err95];
              } else {
                vErrors.push(err95);
              }
              errors++;
            }
          }
        }
        if (data37.maxConcurrency !== void 0) {
          let data40 = data37.maxConcurrency;
          if (!(typeof data40 == "number" && (!(data40 % 1) && !isNaN(data40)) && isFinite(data40))) {
            const err96 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err96];
            } else {
              vErrors.push(err96);
            }
            errors++;
          }
          if (typeof data40 == "number" && isFinite(data40)) {
            if (data40 > 16 || isNaN(data40)) {
              const err97 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/maximum", keyword: "maximum", params: { comparison: "<=", limit: 16 }, message: "must be <= 16" };
              if (vErrors === null) {
                vErrors = [err97];
              } else {
                vErrors.push(err97);
              }
              errors++;
            }
            if (data40 < 1 || isNaN(data40)) {
              const err98 = { instancePath: instancePath + "/limits/maxConcurrency", schemaPath: "#/properties/limits/properties/maxConcurrency/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err98];
              } else {
                vErrors.push(err98);
              }
              errors++;
            }
          }
        }
      } else {
        const err99 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err99];
        } else {
          vErrors.push(err99);
        }
        errors++;
      }
    }
    if (data.integrity !== void 0) {
      let data41 = data.integrity;
      if (typeof data41 === "string") {
        if (func3(data41) > 128) {
          const err100 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err100];
          } else {
            vErrors.push(err100);
          }
          errors++;
        }
        if (!pattern80.test(data41)) {
          const err101 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/pattern", keyword: "pattern", params: { pattern: "^sha256-[A-Za-z0-9+/]{43}=$" }, message: 'must match pattern "^sha256-[A-Za-z0-9+/]{43}=$"' };
          if (vErrors === null) {
            vErrors = [err101];
          } else {
            vErrors.push(err101);
          }
          errors++;
        }
      } else {
        const err102 = { instancePath: instancePath + "/integrity", schemaPath: "#/properties/integrity/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err102];
        } else {
          vErrors.push(err102);
        }
        errors++;
      }
    }
    if (data.signature !== void 0) {
      let data42 = data.signature;
      if (data42 && typeof data42 == "object" && !Array.isArray(data42)) {
        if (data42.algorithm === void 0) {
          const err103 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
          if (vErrors === null) {
            vErrors = [err103];
          } else {
            vErrors.push(err103);
          }
          errors++;
        }
        if (data42.keyId === void 0) {
          const err104 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "keyId" }, message: "must have required property 'keyId'" };
          if (vErrors === null) {
            vErrors = [err104];
          } else {
            vErrors.push(err104);
          }
          errors++;
        }
        if (data42.value === void 0) {
          const err105 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
          if (vErrors === null) {
            vErrors = [err105];
          } else {
            vErrors.push(err105);
          }
          errors++;
        }
        for (const key4 in data42) {
          if (!(key4 === "algorithm" || key4 === "keyId" || key4 === "value")) {
            const err106 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err106];
            } else {
              vErrors.push(err106);
            }
            errors++;
          }
        }
        if (data42.algorithm !== void 0) {
          if ("Ed25519" !== data42.algorithm) {
            const err107 = { instancePath: instancePath + "/signature/algorithm", schemaPath: "#/properties/signature/properties/algorithm/const", keyword: "const", params: { allowedValue: "Ed25519" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err107];
            } else {
              vErrors.push(err107);
            }
            errors++;
          }
        }
        if (data42.keyId !== void 0) {
          let data44 = data42.keyId;
          if (typeof data44 === "string") {
            if (func3(data44) > 128) {
              const err108 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err108];
              } else {
                vErrors.push(err108);
              }
              errors++;
            }
            if (func3(data44) < 1) {
              const err109 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err109];
              } else {
                vErrors.push(err109);
              }
              errors++;
            }
          } else {
            const err110 = { instancePath: instancePath + "/signature/keyId", schemaPath: "#/properties/signature/properties/keyId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err110];
            } else {
              vErrors.push(err110);
            }
            errors++;
          }
        }
        if (data42.value !== void 0) {
          let data45 = data42.value;
          if (typeof data45 === "string") {
            if (func3(data45) > 256) {
              const err111 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
              if (vErrors === null) {
                vErrors = [err111];
              } else {
                vErrors.push(err111);
              }
              errors++;
            }
            if (func3(data45) < 40) {
              const err112 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/minLength", keyword: "minLength", params: { limit: 40 }, message: "must NOT have fewer than 40 characters" };
              if (vErrors === null) {
                vErrors = [err112];
              } else {
                vErrors.push(err112);
              }
              errors++;
            }
          } else {
            const err113 = { instancePath: instancePath + "/signature/value", schemaPath: "#/properties/signature/properties/value/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err113];
            } else {
              vErrors.push(err113);
            }
            errors++;
          }
        }
      } else {
        const err114 = { instancePath: instancePath + "/signature", schemaPath: "#/properties/signature/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err114];
        } else {
          vErrors.push(err114);
        }
        errors++;
      }
    }
  } else {
    const err115 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err115];
    } else {
      vErrors.push(err115);
    }
    errors++;
  }
  validate69.errors = vErrors;
  return errors === 0;
}
var legacy = validate70;
var schema131 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://agcomm.local/schemas/ai/legacy-project.schema.json", "title": "AgComm legacy JSON project", "type": "object", "required": ["nodes"], "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "nodes": { "type": "array", "minItems": 1, "maxItems": 2e3, "items": { "type": "object", "required": ["id", "type"], "properties": { "id": { "$ref": "#/definitions/id" }, "title": { "type": "string", "maxLength": 120 }, "type": { "enum": ["START", "INPUT", "SKILL", "WORKSPACE", "HTTP", "CONDITION", "OUTPUT"] }, "icon": { "type": "string", "maxLength": 16 }, "tone": { "type": "string", "maxLength": 32 }, "note": { "type": "string", "maxLength": 1e3 }, "x": { "type": "number", "minimum": -1e6, "maximum": 1e6 }, "y": { "type": "number", "minimum": -1e6, "maximum": 1e6 }, "outputVar": { "type": "string", "maxLength": 64 }, "output_var": { "type": "string", "maxLength": 64 }, "workspace": { "type": "object" }, "config": { "type": "object" } }, "additionalProperties": true } }, "edges": { "type": "array", "maxItems": 8e3, "items": { "type": "object", "required": ["from", "to"], "properties": { "id": { "$ref": "#/definitions/id" }, "from": { "$ref": "#/definitions/id" }, "to": { "$ref": "#/definitions/id" }, "label": { "type": "string", "maxLength": 200 }, "condition": { "type": "string", "maxLength": 2e3 } }, "additionalProperties": false } }, "skills": { "type": "array", "maxItems": 256, "items": { "type": "object", "required": ["id", "name"], "properties": { "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "description": { "type": "string", "maxLength": 2e3 }, "category": { "type": "string", "maxLength": 64 }, "prompt": { "type": "string", "maxLength": 1048576 }, "pluginIds": { "type": "array", "maxItems": 256, "uniqueItems": true, "items": { "$ref": "#/definitions/id" } } }, "additionalProperties": false } }, "plugins": { "type": "array", "maxItems": 256, "items": { "type": "object", "required": ["id", "name", "description", "version", "runtime", "permissions"], "properties": { "id": { "$ref": "#/definitions/id" }, "name": { "type": "string", "minLength": 1, "maxLength": 120 }, "description": { "type": "string", "maxLength": 2e3 }, "version": { "type": "string", "minLength": 1, "maxLength": 32 }, "runtime": { "enum": ["player", "http"] }, "permissions": { "type": "array", "maxItems": 64, "uniqueItems": true, "items": { "type": "string", "maxLength": 128 } }, "endpoint": { "type": "string", "maxLength": 2048, "pattern": "^https://" }, "source": { "enum": ["builtin", "custom"] } }, "additionalProperties": false } }, "variables": { "type": "array", "maxItems": 512, "items": { "type": "object", "required": ["name", "type", "defaultValue"], "properties": { "name": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]{0,63}$" }, "type": { "enum": ["string", "number", "boolean", "array", "object", "markdown"] }, "defaultValue": { "type": "string", "maxLength": 65536 } }, "additionalProperties": false } }, "visualizations": { "type": "array", "maxItems": 32, "uniqueItems": true, "items": { "type": "string", "maxLength": 64 } } }, "additionalProperties": false, "definitions": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" } } };
var pattern110 = new RegExp("^[A-Za-z_][A-Za-z0-9_]{0,63}$", "u");
function validate70(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.nodes === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "nodes" }, message: "must have required property 'nodes'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "name" || key0 === "nodes" || key0 === "edges" || key0 === "skills" || key0 === "plugins" || key0 === "variables" || key0 === "visualizations")) {
        const err1 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 === "string") {
        if (func3(data0) > 120) {
          const err2 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (func3(data0) < 1) {
          const err3 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.nodes !== void 0) {
      let data1 = data.nodes;
      if (Array.isArray(data1)) {
        if (data1.length > 2e3) {
          const err5 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/maxItems", keyword: "maxItems", params: { limit: 2e3 }, message: "must NOT have more than 2000 items" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        if (data1.length < 1) {
          const err6 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
            if (data2.id === void 0) {
              const err7 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/properties/nodes/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
            if (data2.type === void 0) {
              const err8 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/properties/nodes/items/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
            if (data2.id !== void 0) {
              let data3 = data2.id;
              if (typeof data3 === "string") {
                if (!pattern0.test(data3)) {
                  const err9 = { instancePath: instancePath + "/nodes/" + i0 + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err9];
                  } else {
                    vErrors.push(err9);
                  }
                  errors++;
                }
              } else {
                const err10 = { instancePath: instancePath + "/nodes/" + i0 + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
              }
            }
            if (data2.title !== void 0) {
              let data4 = data2.title;
              if (typeof data4 === "string") {
                if (func3(data4) > 120) {
                  const err11 = { instancePath: instancePath + "/nodes/" + i0 + "/title", schemaPath: "#/properties/nodes/items/properties/title/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
                  if (vErrors === null) {
                    vErrors = [err11];
                  } else {
                    vErrors.push(err11);
                  }
                  errors++;
                }
              } else {
                const err12 = { instancePath: instancePath + "/nodes/" + i0 + "/title", schemaPath: "#/properties/nodes/items/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
              }
            }
            if (data2.type !== void 0) {
              let data5 = data2.type;
              if (!(data5 === "START" || data5 === "INPUT" || data5 === "SKILL" || data5 === "WORKSPACE" || data5 === "HTTP" || data5 === "CONDITION" || data5 === "OUTPUT")) {
                const err13 = { instancePath: instancePath + "/nodes/" + i0 + "/type", schemaPath: "#/properties/nodes/items/properties/type/enum", keyword: "enum", params: { allowedValues: schema131.properties.nodes.items.properties.type.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err13];
                } else {
                  vErrors.push(err13);
                }
                errors++;
              }
            }
            if (data2.icon !== void 0) {
              let data6 = data2.icon;
              if (typeof data6 === "string") {
                if (func3(data6) > 16) {
                  const err14 = { instancePath: instancePath + "/nodes/" + i0 + "/icon", schemaPath: "#/properties/nodes/items/properties/icon/maxLength", keyword: "maxLength", params: { limit: 16 }, message: "must NOT have more than 16 characters" };
                  if (vErrors === null) {
                    vErrors = [err14];
                  } else {
                    vErrors.push(err14);
                  }
                  errors++;
                }
              } else {
                const err15 = { instancePath: instancePath + "/nodes/" + i0 + "/icon", schemaPath: "#/properties/nodes/items/properties/icon/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
            }
            if (data2.tone !== void 0) {
              let data7 = data2.tone;
              if (typeof data7 === "string") {
                if (func3(data7) > 32) {
                  const err16 = { instancePath: instancePath + "/nodes/" + i0 + "/tone", schemaPath: "#/properties/nodes/items/properties/tone/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
                  if (vErrors === null) {
                    vErrors = [err16];
                  } else {
                    vErrors.push(err16);
                  }
                  errors++;
                }
              } else {
                const err17 = { instancePath: instancePath + "/nodes/" + i0 + "/tone", schemaPath: "#/properties/nodes/items/properties/tone/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
            if (data2.note !== void 0) {
              let data8 = data2.note;
              if (typeof data8 === "string") {
                if (func3(data8) > 1e3) {
                  const err18 = { instancePath: instancePath + "/nodes/" + i0 + "/note", schemaPath: "#/properties/nodes/items/properties/note/maxLength", keyword: "maxLength", params: { limit: 1e3 }, message: "must NOT have more than 1000 characters" };
                  if (vErrors === null) {
                    vErrors = [err18];
                  } else {
                    vErrors.push(err18);
                  }
                  errors++;
                }
              } else {
                const err19 = { instancePath: instancePath + "/nodes/" + i0 + "/note", schemaPath: "#/properties/nodes/items/properties/note/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err19];
                } else {
                  vErrors.push(err19);
                }
                errors++;
              }
            }
            if (data2.x !== void 0) {
              let data9 = data2.x;
              if (typeof data9 == "number" && isFinite(data9)) {
                if (data9 > 1e6 || isNaN(data9)) {
                  const err20 = { instancePath: instancePath + "/nodes/" + i0 + "/x", schemaPath: "#/properties/nodes/items/properties/x/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1e6 }, message: "must be <= 1000000" };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
                if (data9 < -1e6 || isNaN(data9)) {
                  const err21 = { instancePath: instancePath + "/nodes/" + i0 + "/x", schemaPath: "#/properties/nodes/items/properties/x/minimum", keyword: "minimum", params: { comparison: ">=", limit: -1e6 }, message: "must be >= -1000000" };
                  if (vErrors === null) {
                    vErrors = [err21];
                  } else {
                    vErrors.push(err21);
                  }
                  errors++;
                }
              } else {
                const err22 = { instancePath: instancePath + "/nodes/" + i0 + "/x", schemaPath: "#/properties/nodes/items/properties/x/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                if (vErrors === null) {
                  vErrors = [err22];
                } else {
                  vErrors.push(err22);
                }
                errors++;
              }
            }
            if (data2.y !== void 0) {
              let data10 = data2.y;
              if (typeof data10 == "number" && isFinite(data10)) {
                if (data10 > 1e6 || isNaN(data10)) {
                  const err23 = { instancePath: instancePath + "/nodes/" + i0 + "/y", schemaPath: "#/properties/nodes/items/properties/y/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1e6 }, message: "must be <= 1000000" };
                  if (vErrors === null) {
                    vErrors = [err23];
                  } else {
                    vErrors.push(err23);
                  }
                  errors++;
                }
                if (data10 < -1e6 || isNaN(data10)) {
                  const err24 = { instancePath: instancePath + "/nodes/" + i0 + "/y", schemaPath: "#/properties/nodes/items/properties/y/minimum", keyword: "minimum", params: { comparison: ">=", limit: -1e6 }, message: "must be >= -1000000" };
                  if (vErrors === null) {
                    vErrors = [err24];
                  } else {
                    vErrors.push(err24);
                  }
                  errors++;
                }
              } else {
                const err25 = { instancePath: instancePath + "/nodes/" + i0 + "/y", schemaPath: "#/properties/nodes/items/properties/y/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
            if (data2.outputVar !== void 0) {
              let data11 = data2.outputVar;
              if (typeof data11 === "string") {
                if (func3(data11) > 64) {
                  const err26 = { instancePath: instancePath + "/nodes/" + i0 + "/outputVar", schemaPath: "#/properties/nodes/items/properties/outputVar/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
                  if (vErrors === null) {
                    vErrors = [err26];
                  } else {
                    vErrors.push(err26);
                  }
                  errors++;
                }
              } else {
                const err27 = { instancePath: instancePath + "/nodes/" + i0 + "/outputVar", schemaPath: "#/properties/nodes/items/properties/outputVar/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err27];
                } else {
                  vErrors.push(err27);
                }
                errors++;
              }
            }
            if (data2.output_var !== void 0) {
              let data12 = data2.output_var;
              if (typeof data12 === "string") {
                if (func3(data12) > 64) {
                  const err28 = { instancePath: instancePath + "/nodes/" + i0 + "/output_var", schemaPath: "#/properties/nodes/items/properties/output_var/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
                  if (vErrors === null) {
                    vErrors = [err28];
                  } else {
                    vErrors.push(err28);
                  }
                  errors++;
                }
              } else {
                const err29 = { instancePath: instancePath + "/nodes/" + i0 + "/output_var", schemaPath: "#/properties/nodes/items/properties/output_var/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err29];
                } else {
                  vErrors.push(err29);
                }
                errors++;
              }
            }
            if (data2.workspace !== void 0) {
              let data13 = data2.workspace;
              if (!(data13 && typeof data13 == "object" && !Array.isArray(data13))) {
                const err30 = { instancePath: instancePath + "/nodes/" + i0 + "/workspace", schemaPath: "#/properties/nodes/items/properties/workspace/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err30];
                } else {
                  vErrors.push(err30);
                }
                errors++;
              }
            }
            if (data2.config !== void 0) {
              let data14 = data2.config;
              if (!(data14 && typeof data14 == "object" && !Array.isArray(data14))) {
                const err31 = { instancePath: instancePath + "/nodes/" + i0 + "/config", schemaPath: "#/properties/nodes/items/properties/config/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err31];
                } else {
                  vErrors.push(err31);
                }
                errors++;
              }
            }
          } else {
            const err32 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/properties/nodes/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
      } else {
        const err33 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
    }
    if (data.edges !== void 0) {
      let data15 = data.edges;
      if (Array.isArray(data15)) {
        if (data15.length > 8e3) {
          const err34 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/maxItems", keyword: "maxItems", params: { limit: 8e3 }, message: "must NOT have more than 8000 items" };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
        const len1 = data15.length;
        for (let i1 = 0; i1 < len1; i1++) {
          let data16 = data15[i1];
          if (data16 && typeof data16 == "object" && !Array.isArray(data16)) {
            if (data16.from === void 0) {
              const err35 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
              if (vErrors === null) {
                vErrors = [err35];
              } else {
                vErrors.push(err35);
              }
              errors++;
            }
            if (data16.to === void 0) {
              const err36 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/properties/edges/items/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
            for (const key1 in data16) {
              if (!(key1 === "id" || key1 === "from" || key1 === "to" || key1 === "label" || key1 === "condition")) {
                const err37 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/properties/edges/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err37];
                } else {
                  vErrors.push(err37);
                }
                errors++;
              }
            }
            if (data16.id !== void 0) {
              let data17 = data16.id;
              if (typeof data17 === "string") {
                if (!pattern0.test(data17)) {
                  const err38 = { instancePath: instancePath + "/edges/" + i1 + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err38];
                  } else {
                    vErrors.push(err38);
                  }
                  errors++;
                }
              } else {
                const err39 = { instancePath: instancePath + "/edges/" + i1 + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err39];
                } else {
                  vErrors.push(err39);
                }
                errors++;
              }
            }
            if (data16.from !== void 0) {
              let data18 = data16.from;
              if (typeof data18 === "string") {
                if (!pattern0.test(data18)) {
                  const err40 = { instancePath: instancePath + "/edges/" + i1 + "/from", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err40];
                  } else {
                    vErrors.push(err40);
                  }
                  errors++;
                }
              } else {
                const err41 = { instancePath: instancePath + "/edges/" + i1 + "/from", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err41];
                } else {
                  vErrors.push(err41);
                }
                errors++;
              }
            }
            if (data16.to !== void 0) {
              let data19 = data16.to;
              if (typeof data19 === "string") {
                if (!pattern0.test(data19)) {
                  const err42 = { instancePath: instancePath + "/edges/" + i1 + "/to", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err42];
                  } else {
                    vErrors.push(err42);
                  }
                  errors++;
                }
              } else {
                const err43 = { instancePath: instancePath + "/edges/" + i1 + "/to", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err43];
                } else {
                  vErrors.push(err43);
                }
                errors++;
              }
            }
            if (data16.label !== void 0) {
              let data20 = data16.label;
              if (typeof data20 === "string") {
                if (func3(data20) > 200) {
                  const err44 = { instancePath: instancePath + "/edges/" + i1 + "/label", schemaPath: "#/properties/edges/items/properties/label/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
                  if (vErrors === null) {
                    vErrors = [err44];
                  } else {
                    vErrors.push(err44);
                  }
                  errors++;
                }
              } else {
                const err45 = { instancePath: instancePath + "/edges/" + i1 + "/label", schemaPath: "#/properties/edges/items/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err45];
                } else {
                  vErrors.push(err45);
                }
                errors++;
              }
            }
            if (data16.condition !== void 0) {
              let data21 = data16.condition;
              if (typeof data21 === "string") {
                if (func3(data21) > 2e3) {
                  const err46 = { instancePath: instancePath + "/edges/" + i1 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
                  if (vErrors === null) {
                    vErrors = [err46];
                  } else {
                    vErrors.push(err46);
                  }
                  errors++;
                }
              } else {
                const err47 = { instancePath: instancePath + "/edges/" + i1 + "/condition", schemaPath: "#/properties/edges/items/properties/condition/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err47];
                } else {
                  vErrors.push(err47);
                }
                errors++;
              }
            }
          } else {
            const err48 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/properties/edges/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err48];
            } else {
              vErrors.push(err48);
            }
            errors++;
          }
        }
      } else {
        const err49 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
    }
    if (data.skills !== void 0) {
      let data22 = data.skills;
      if (Array.isArray(data22)) {
        if (data22.length > 256) {
          const err50 = { instancePath: instancePath + "/skills", schemaPath: "#/properties/skills/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        }
        const len2 = data22.length;
        for (let i2 = 0; i2 < len2; i2++) {
          let data23 = data22[i2];
          if (data23 && typeof data23 == "object" && !Array.isArray(data23)) {
            if (data23.id === void 0) {
              const err51 = { instancePath: instancePath + "/skills/" + i2, schemaPath: "#/properties/skills/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              if (vErrors === null) {
                vErrors = [err51];
              } else {
                vErrors.push(err51);
              }
              errors++;
            }
            if (data23.name === void 0) {
              const err52 = { instancePath: instancePath + "/skills/" + i2, schemaPath: "#/properties/skills/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err52];
              } else {
                vErrors.push(err52);
              }
              errors++;
            }
            for (const key2 in data23) {
              if (!(key2 === "id" || key2 === "name" || key2 === "description" || key2 === "category" || key2 === "prompt" || key2 === "pluginIds")) {
                const err53 = { instancePath: instancePath + "/skills/" + i2, schemaPath: "#/properties/skills/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err53];
                } else {
                  vErrors.push(err53);
                }
                errors++;
              }
            }
            if (data23.id !== void 0) {
              let data24 = data23.id;
              if (typeof data24 === "string") {
                if (!pattern0.test(data24)) {
                  const err54 = { instancePath: instancePath + "/skills/" + i2 + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err54];
                  } else {
                    vErrors.push(err54);
                  }
                  errors++;
                }
              } else {
                const err55 = { instancePath: instancePath + "/skills/" + i2 + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err55];
                } else {
                  vErrors.push(err55);
                }
                errors++;
              }
            }
            if (data23.name !== void 0) {
              let data25 = data23.name;
              if (typeof data25 === "string") {
                if (func3(data25) > 120) {
                  const err56 = { instancePath: instancePath + "/skills/" + i2 + "/name", schemaPath: "#/properties/skills/items/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
                  if (vErrors === null) {
                    vErrors = [err56];
                  } else {
                    vErrors.push(err56);
                  }
                  errors++;
                }
                if (func3(data25) < 1) {
                  const err57 = { instancePath: instancePath + "/skills/" + i2 + "/name", schemaPath: "#/properties/skills/items/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err57];
                  } else {
                    vErrors.push(err57);
                  }
                  errors++;
                }
              } else {
                const err58 = { instancePath: instancePath + "/skills/" + i2 + "/name", schemaPath: "#/properties/skills/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err58];
                } else {
                  vErrors.push(err58);
                }
                errors++;
              }
            }
            if (data23.description !== void 0) {
              let data26 = data23.description;
              if (typeof data26 === "string") {
                if (func3(data26) > 2e3) {
                  const err59 = { instancePath: instancePath + "/skills/" + i2 + "/description", schemaPath: "#/properties/skills/items/properties/description/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
                  if (vErrors === null) {
                    vErrors = [err59];
                  } else {
                    vErrors.push(err59);
                  }
                  errors++;
                }
              } else {
                const err60 = { instancePath: instancePath + "/skills/" + i2 + "/description", schemaPath: "#/properties/skills/items/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err60];
                } else {
                  vErrors.push(err60);
                }
                errors++;
              }
            }
            if (data23.category !== void 0) {
              let data27 = data23.category;
              if (typeof data27 === "string") {
                if (func3(data27) > 64) {
                  const err61 = { instancePath: instancePath + "/skills/" + i2 + "/category", schemaPath: "#/properties/skills/items/properties/category/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
                  if (vErrors === null) {
                    vErrors = [err61];
                  } else {
                    vErrors.push(err61);
                  }
                  errors++;
                }
              } else {
                const err62 = { instancePath: instancePath + "/skills/" + i2 + "/category", schemaPath: "#/properties/skills/items/properties/category/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err62];
                } else {
                  vErrors.push(err62);
                }
                errors++;
              }
            }
            if (data23.prompt !== void 0) {
              let data28 = data23.prompt;
              if (typeof data28 === "string") {
                if (func3(data28) > 1048576) {
                  const err63 = { instancePath: instancePath + "/skills/" + i2 + "/prompt", schemaPath: "#/properties/skills/items/properties/prompt/maxLength", keyword: "maxLength", params: { limit: 1048576 }, message: "must NOT have more than 1048576 characters" };
                  if (vErrors === null) {
                    vErrors = [err63];
                  } else {
                    vErrors.push(err63);
                  }
                  errors++;
                }
              } else {
                const err64 = { instancePath: instancePath + "/skills/" + i2 + "/prompt", schemaPath: "#/properties/skills/items/properties/prompt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err64];
                } else {
                  vErrors.push(err64);
                }
                errors++;
              }
            }
            if (data23.pluginIds !== void 0) {
              let data29 = data23.pluginIds;
              if (Array.isArray(data29)) {
                if (data29.length > 256) {
                  const err65 = { instancePath: instancePath + "/skills/" + i2 + "/pluginIds", schemaPath: "#/properties/skills/items/properties/pluginIds/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
                  if (vErrors === null) {
                    vErrors = [err65];
                  } else {
                    vErrors.push(err65);
                  }
                  errors++;
                }
                const len3 = data29.length;
                for (let i3 = 0; i3 < len3; i3++) {
                  let data30 = data29[i3];
                  if (typeof data30 === "string") {
                    if (!pattern0.test(data30)) {
                      const err66 = { instancePath: instancePath + "/skills/" + i2 + "/pluginIds/" + i3, schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                      if (vErrors === null) {
                        vErrors = [err66];
                      } else {
                        vErrors.push(err66);
                      }
                      errors++;
                    }
                  } else {
                    const err67 = { instancePath: instancePath + "/skills/" + i2 + "/pluginIds/" + i3, schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err67];
                    } else {
                      vErrors.push(err67);
                    }
                    errors++;
                  }
                }
                let i4 = data29.length;
                let j0;
                if (i4 > 1) {
                  outer0: for (; i4--; ) {
                    for (j0 = i4; j0--; ) {
                      if (func0(data29[i4], data29[j0])) {
                        const err68 = { instancePath: instancePath + "/skills/" + i2 + "/pluginIds", schemaPath: "#/properties/skills/items/properties/pluginIds/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i4 + " are identical)" };
                        if (vErrors === null) {
                          vErrors = [err68];
                        } else {
                          vErrors.push(err68);
                        }
                        errors++;
                        break outer0;
                      }
                    }
                  }
                }
              } else {
                const err69 = { instancePath: instancePath + "/skills/" + i2 + "/pluginIds", schemaPath: "#/properties/skills/items/properties/pluginIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                if (vErrors === null) {
                  vErrors = [err69];
                } else {
                  vErrors.push(err69);
                }
                errors++;
              }
            }
          } else {
            const err70 = { instancePath: instancePath + "/skills/" + i2, schemaPath: "#/properties/skills/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err70];
            } else {
              vErrors.push(err70);
            }
            errors++;
          }
        }
      } else {
        const err71 = { instancePath: instancePath + "/skills", schemaPath: "#/properties/skills/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err71];
        } else {
          vErrors.push(err71);
        }
        errors++;
      }
    }
    if (data.plugins !== void 0) {
      let data31 = data.plugins;
      if (Array.isArray(data31)) {
        if (data31.length > 256) {
          const err72 = { instancePath: instancePath + "/plugins", schemaPath: "#/properties/plugins/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
          if (vErrors === null) {
            vErrors = [err72];
          } else {
            vErrors.push(err72);
          }
          errors++;
        }
        const len4 = data31.length;
        for (let i5 = 0; i5 < len4; i5++) {
          let data32 = data31[i5];
          if (data32 && typeof data32 == "object" && !Array.isArray(data32)) {
            if (data32.id === void 0) {
              const err73 = { instancePath: instancePath + "/plugins/" + i5, schemaPath: "#/properties/plugins/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              if (vErrors === null) {
                vErrors = [err73];
              } else {
                vErrors.push(err73);
              }
              errors++;
            }
            if (data32.name === void 0) {
              const err74 = { instancePath: instancePath + "/plugins/" + i5, schemaPath: "#/properties/plugins/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err74];
              } else {
                vErrors.push(err74);
              }
              errors++;
            }
            if (data32.description === void 0) {
              const err75 = { instancePath: instancePath + "/plugins/" + i5, schemaPath: "#/properties/plugins/items/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
              if (vErrors === null) {
                vErrors = [err75];
              } else {
                vErrors.push(err75);
              }
              errors++;
            }
            if (data32.version === void 0) {
              const err76 = { instancePath: instancePath + "/plugins/" + i5, schemaPath: "#/properties/plugins/items/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
              if (vErrors === null) {
                vErrors = [err76];
              } else {
                vErrors.push(err76);
              }
              errors++;
            }
            if (data32.runtime === void 0) {
              const err77 = { instancePath: instancePath + "/plugins/" + i5, schemaPath: "#/properties/plugins/items/required", keyword: "required", params: { missingProperty: "runtime" }, message: "must have required property 'runtime'" };
              if (vErrors === null) {
                vErrors = [err77];
              } else {
                vErrors.push(err77);
              }
              errors++;
            }
            if (data32.permissions === void 0) {
              const err78 = { instancePath: instancePath + "/plugins/" + i5, schemaPath: "#/properties/plugins/items/required", keyword: "required", params: { missingProperty: "permissions" }, message: "must have required property 'permissions'" };
              if (vErrors === null) {
                vErrors = [err78];
              } else {
                vErrors.push(err78);
              }
              errors++;
            }
            for (const key3 in data32) {
              if (!(key3 === "id" || key3 === "name" || key3 === "description" || key3 === "version" || key3 === "runtime" || key3 === "permissions" || key3 === "endpoint" || key3 === "source")) {
                const err79 = { instancePath: instancePath + "/plugins/" + i5, schemaPath: "#/properties/plugins/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err79];
                } else {
                  vErrors.push(err79);
                }
                errors++;
              }
            }
            if (data32.id !== void 0) {
              let data33 = data32.id;
              if (typeof data33 === "string") {
                if (!pattern0.test(data33)) {
                  const err80 = { instancePath: instancePath + "/plugins/" + i5 + "/id", schemaPath: "#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err80];
                  } else {
                    vErrors.push(err80);
                  }
                  errors++;
                }
              } else {
                const err81 = { instancePath: instancePath + "/plugins/" + i5 + "/id", schemaPath: "#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err81];
                } else {
                  vErrors.push(err81);
                }
                errors++;
              }
            }
            if (data32.name !== void 0) {
              let data34 = data32.name;
              if (typeof data34 === "string") {
                if (func3(data34) > 120) {
                  const err82 = { instancePath: instancePath + "/plugins/" + i5 + "/name", schemaPath: "#/properties/plugins/items/properties/name/maxLength", keyword: "maxLength", params: { limit: 120 }, message: "must NOT have more than 120 characters" };
                  if (vErrors === null) {
                    vErrors = [err82];
                  } else {
                    vErrors.push(err82);
                  }
                  errors++;
                }
                if (func3(data34) < 1) {
                  const err83 = { instancePath: instancePath + "/plugins/" + i5 + "/name", schemaPath: "#/properties/plugins/items/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err83];
                  } else {
                    vErrors.push(err83);
                  }
                  errors++;
                }
              } else {
                const err84 = { instancePath: instancePath + "/plugins/" + i5 + "/name", schemaPath: "#/properties/plugins/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err84];
                } else {
                  vErrors.push(err84);
                }
                errors++;
              }
            }
            if (data32.description !== void 0) {
              let data35 = data32.description;
              if (typeof data35 === "string") {
                if (func3(data35) > 2e3) {
                  const err85 = { instancePath: instancePath + "/plugins/" + i5 + "/description", schemaPath: "#/properties/plugins/items/properties/description/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
                  if (vErrors === null) {
                    vErrors = [err85];
                  } else {
                    vErrors.push(err85);
                  }
                  errors++;
                }
              } else {
                const err86 = { instancePath: instancePath + "/plugins/" + i5 + "/description", schemaPath: "#/properties/plugins/items/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err86];
                } else {
                  vErrors.push(err86);
                }
                errors++;
              }
            }
            if (data32.version !== void 0) {
              let data36 = data32.version;
              if (typeof data36 === "string") {
                if (func3(data36) > 32) {
                  const err87 = { instancePath: instancePath + "/plugins/" + i5 + "/version", schemaPath: "#/properties/plugins/items/properties/version/maxLength", keyword: "maxLength", params: { limit: 32 }, message: "must NOT have more than 32 characters" };
                  if (vErrors === null) {
                    vErrors = [err87];
                  } else {
                    vErrors.push(err87);
                  }
                  errors++;
                }
                if (func3(data36) < 1) {
                  const err88 = { instancePath: instancePath + "/plugins/" + i5 + "/version", schemaPath: "#/properties/plugins/items/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err88];
                  } else {
                    vErrors.push(err88);
                  }
                  errors++;
                }
              } else {
                const err89 = { instancePath: instancePath + "/plugins/" + i5 + "/version", schemaPath: "#/properties/plugins/items/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err89];
                } else {
                  vErrors.push(err89);
                }
                errors++;
              }
            }
            if (data32.runtime !== void 0) {
              let data37 = data32.runtime;
              if (!(data37 === "player" || data37 === "http")) {
                const err90 = { instancePath: instancePath + "/plugins/" + i5 + "/runtime", schemaPath: "#/properties/plugins/items/properties/runtime/enum", keyword: "enum", params: { allowedValues: schema131.properties.plugins.items.properties.runtime.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err90];
                } else {
                  vErrors.push(err90);
                }
                errors++;
              }
            }
            if (data32.permissions !== void 0) {
              let data38 = data32.permissions;
              if (Array.isArray(data38)) {
                if (data38.length > 64) {
                  const err91 = { instancePath: instancePath + "/plugins/" + i5 + "/permissions", schemaPath: "#/properties/plugins/items/properties/permissions/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
                  if (vErrors === null) {
                    vErrors = [err91];
                  } else {
                    vErrors.push(err91);
                  }
                  errors++;
                }
                const len5 = data38.length;
                for (let i6 = 0; i6 < len5; i6++) {
                  let data39 = data38[i6];
                  if (typeof data39 === "string") {
                    if (func3(data39) > 128) {
                      const err92 = { instancePath: instancePath + "/plugins/" + i5 + "/permissions/" + i6, schemaPath: "#/properties/plugins/items/properties/permissions/items/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                      if (vErrors === null) {
                        vErrors = [err92];
                      } else {
                        vErrors.push(err92);
                      }
                      errors++;
                    }
                  } else {
                    const err93 = { instancePath: instancePath + "/plugins/" + i5 + "/permissions/" + i6, schemaPath: "#/properties/plugins/items/properties/permissions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err93];
                    } else {
                      vErrors.push(err93);
                    }
                    errors++;
                  }
                }
                let i7 = data38.length;
                let j1;
                if (i7 > 1) {
                  const indices0 = {};
                  for (; i7--; ) {
                    let item0 = data38[i7];
                    if (typeof item0 !== "string") {
                      continue;
                    }
                    if (typeof indices0[item0] == "number") {
                      j1 = indices0[item0];
                      const err94 = { instancePath: instancePath + "/plugins/" + i5 + "/permissions", schemaPath: "#/properties/plugins/items/properties/permissions/uniqueItems", keyword: "uniqueItems", params: { i: i7, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i7 + " are identical)" };
                      if (vErrors === null) {
                        vErrors = [err94];
                      } else {
                        vErrors.push(err94);
                      }
                      errors++;
                      break;
                    }
                    indices0[item0] = i7;
                  }
                }
              } else {
                const err95 = { instancePath: instancePath + "/plugins/" + i5 + "/permissions", schemaPath: "#/properties/plugins/items/properties/permissions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                if (vErrors === null) {
                  vErrors = [err95];
                } else {
                  vErrors.push(err95);
                }
                errors++;
              }
            }
            if (data32.endpoint !== void 0) {
              let data40 = data32.endpoint;
              if (typeof data40 === "string") {
                if (func3(data40) > 2048) {
                  const err96 = { instancePath: instancePath + "/plugins/" + i5 + "/endpoint", schemaPath: "#/properties/plugins/items/properties/endpoint/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
                  if (vErrors === null) {
                    vErrors = [err96];
                  } else {
                    vErrors.push(err96);
                  }
                  errors++;
                }
                if (!pattern67.test(data40)) {
                  const err97 = { instancePath: instancePath + "/plugins/" + i5 + "/endpoint", schemaPath: "#/properties/plugins/items/properties/endpoint/pattern", keyword: "pattern", params: { pattern: "^https://" }, message: 'must match pattern "^https://"' };
                  if (vErrors === null) {
                    vErrors = [err97];
                  } else {
                    vErrors.push(err97);
                  }
                  errors++;
                }
              } else {
                const err98 = { instancePath: instancePath + "/plugins/" + i5 + "/endpoint", schemaPath: "#/properties/plugins/items/properties/endpoint/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err98];
                } else {
                  vErrors.push(err98);
                }
                errors++;
              }
            }
            if (data32.source !== void 0) {
              let data41 = data32.source;
              if (!(data41 === "builtin" || data41 === "custom")) {
                const err99 = { instancePath: instancePath + "/plugins/" + i5 + "/source", schemaPath: "#/properties/plugins/items/properties/source/enum", keyword: "enum", params: { allowedValues: schema131.properties.plugins.items.properties.source.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err99];
                } else {
                  vErrors.push(err99);
                }
                errors++;
              }
            }
          } else {
            const err100 = { instancePath: instancePath + "/plugins/" + i5, schemaPath: "#/properties/plugins/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err100];
            } else {
              vErrors.push(err100);
            }
            errors++;
          }
        }
      } else {
        const err101 = { instancePath: instancePath + "/plugins", schemaPath: "#/properties/plugins/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err101];
        } else {
          vErrors.push(err101);
        }
        errors++;
      }
    }
    if (data.variables !== void 0) {
      let data42 = data.variables;
      if (Array.isArray(data42)) {
        if (data42.length > 512) {
          const err102 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/maxItems", keyword: "maxItems", params: { limit: 512 }, message: "must NOT have more than 512 items" };
          if (vErrors === null) {
            vErrors = [err102];
          } else {
            vErrors.push(err102);
          }
          errors++;
        }
        const len6 = data42.length;
        for (let i8 = 0; i8 < len6; i8++) {
          let data43 = data42[i8];
          if (data43 && typeof data43 == "object" && !Array.isArray(data43)) {
            if (data43.name === void 0) {
              const err103 = { instancePath: instancePath + "/variables/" + i8, schemaPath: "#/properties/variables/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err103];
              } else {
                vErrors.push(err103);
              }
              errors++;
            }
            if (data43.type === void 0) {
              const err104 = { instancePath: instancePath + "/variables/" + i8, schemaPath: "#/properties/variables/items/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
              if (vErrors === null) {
                vErrors = [err104];
              } else {
                vErrors.push(err104);
              }
              errors++;
            }
            if (data43.defaultValue === void 0) {
              const err105 = { instancePath: instancePath + "/variables/" + i8, schemaPath: "#/properties/variables/items/required", keyword: "required", params: { missingProperty: "defaultValue" }, message: "must have required property 'defaultValue'" };
              if (vErrors === null) {
                vErrors = [err105];
              } else {
                vErrors.push(err105);
              }
              errors++;
            }
            for (const key4 in data43) {
              if (!(key4 === "name" || key4 === "type" || key4 === "defaultValue")) {
                const err106 = { instancePath: instancePath + "/variables/" + i8, schemaPath: "#/properties/variables/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err106];
                } else {
                  vErrors.push(err106);
                }
                errors++;
              }
            }
            if (data43.name !== void 0) {
              let data44 = data43.name;
              if (typeof data44 === "string") {
                if (!pattern110.test(data44)) {
                  const err107 = { instancePath: instancePath + "/variables/" + i8 + "/name", schemaPath: "#/properties/variables/items/properties/name/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z_][A-Za-z0-9_]{0,63}$" }, message: 'must match pattern "^[A-Za-z_][A-Za-z0-9_]{0,63}$"' };
                  if (vErrors === null) {
                    vErrors = [err107];
                  } else {
                    vErrors.push(err107);
                  }
                  errors++;
                }
              } else {
                const err108 = { instancePath: instancePath + "/variables/" + i8 + "/name", schemaPath: "#/properties/variables/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err108];
                } else {
                  vErrors.push(err108);
                }
                errors++;
              }
            }
            if (data43.type !== void 0) {
              let data45 = data43.type;
              if (!(data45 === "string" || data45 === "number" || data45 === "boolean" || data45 === "array" || data45 === "object" || data45 === "markdown")) {
                const err109 = { instancePath: instancePath + "/variables/" + i8 + "/type", schemaPath: "#/properties/variables/items/properties/type/enum", keyword: "enum", params: { allowedValues: schema131.properties.variables.items.properties.type.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err109];
                } else {
                  vErrors.push(err109);
                }
                errors++;
              }
            }
            if (data43.defaultValue !== void 0) {
              let data46 = data43.defaultValue;
              if (typeof data46 === "string") {
                if (func3(data46) > 65536) {
                  const err110 = { instancePath: instancePath + "/variables/" + i8 + "/defaultValue", schemaPath: "#/properties/variables/items/properties/defaultValue/maxLength", keyword: "maxLength", params: { limit: 65536 }, message: "must NOT have more than 65536 characters" };
                  if (vErrors === null) {
                    vErrors = [err110];
                  } else {
                    vErrors.push(err110);
                  }
                  errors++;
                }
              } else {
                const err111 = { instancePath: instancePath + "/variables/" + i8 + "/defaultValue", schemaPath: "#/properties/variables/items/properties/defaultValue/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err111];
                } else {
                  vErrors.push(err111);
                }
                errors++;
              }
            }
          } else {
            const err112 = { instancePath: instancePath + "/variables/" + i8, schemaPath: "#/properties/variables/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err112];
            } else {
              vErrors.push(err112);
            }
            errors++;
          }
        }
      } else {
        const err113 = { instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err113];
        } else {
          vErrors.push(err113);
        }
        errors++;
      }
    }
    if (data.visualizations !== void 0) {
      let data47 = data.visualizations;
      if (Array.isArray(data47)) {
        if (data47.length > 32) {
          const err114 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
          if (vErrors === null) {
            vErrors = [err114];
          } else {
            vErrors.push(err114);
          }
          errors++;
        }
        const len7 = data47.length;
        for (let i9 = 0; i9 < len7; i9++) {
          let data48 = data47[i9];
          if (typeof data48 === "string") {
            if (func3(data48) > 64) {
              const err115 = { instancePath: instancePath + "/visualizations/" + i9, schemaPath: "#/properties/visualizations/items/maxLength", keyword: "maxLength", params: { limit: 64 }, message: "must NOT have more than 64 characters" };
              if (vErrors === null) {
                vErrors = [err115];
              } else {
                vErrors.push(err115);
              }
              errors++;
            }
          } else {
            const err116 = { instancePath: instancePath + "/visualizations/" + i9, schemaPath: "#/properties/visualizations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err116];
            } else {
              vErrors.push(err116);
            }
            errors++;
          }
        }
        let i10 = data47.length;
        let j2;
        if (i10 > 1) {
          const indices1 = {};
          for (; i10--; ) {
            let item1 = data47[i10];
            if (typeof item1 !== "string") {
              continue;
            }
            if (typeof indices1[item1] == "number") {
              j2 = indices1[item1];
              const err117 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/uniqueItems", keyword: "uniqueItems", params: { i: i10, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i10 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err117];
              } else {
                vErrors.push(err117);
              }
              errors++;
              break;
            }
            indices1[item1] = i10;
          }
        }
      } else {
        const err118 = { instancePath: instancePath + "/visualizations", schemaPath: "#/properties/visualizations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err118];
        } else {
          vErrors.push(err118);
        }
        errors++;
      }
    }
  } else {
    const err119 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err119];
    } else {
      vErrors.push(err119);
    }
    errors++;
  }
  validate70.errors = vErrors;
  return errors === 0;
}

// ../../domain/package/schema.ts
var CURRENT_AI_FORMAT_VERSION = 2;
var AiPackageValidationError = class extends Error {
  constructor(code, phase, message, issues = []) {
    super(message);
    this.name = "AiPackageValidationError";
    this.code = code;
    this.phase = phase;
    this.issues = issues;
  }
};
var validators = {
  manifestV1,
  manifestV2,
  flow,
  node,
  skillV1,
  skillV2,
  plugin,
  legacy
};
function issuesFrom(errors, path) {
  return (errors ?? []).map((error) => ({
    code: `SCHEMA_${error.keyword.toUpperCase()}`,
    path,
    jsonPointer: error.instancePath || "/",
    message: error.message ? `${error.instancePath || "/"} ${error.message}` : "\u4E0D\u7B26\u5408 Schema"
  }));
}
function assertSchema(validator, value, path) {
  if (validator(value)) return;
  const issues = issuesFrom(validator.errors, path);
  const first = issues[0];
  throw new AiPackageValidationError("SCHEMA_INVALID", "validate", `${path}${first?.jsonPointer === "/" ? "" : first?.jsonPointer || ""}\uFF1A${first?.message || "\u4E0D\u7B26\u5408 Schema"}`, issues);
}
function validateLegacyProject(value) {
  assertSchema(validators.legacy, value, "legacy.json");
}
function validateManifest(value, version) {
  assertSchema(version === 1 ? validators.manifestV1 : validators.manifestV2, value, "manifest.json");
}
function validateFlowDocument(value) {
  assertSchema(validators.flow, value, "flow/flow.json");
}
function validateNodeDocument(value, path) {
  assertSchema(validators.node, value, path);
}
function validateSkillDocument(value, path, version) {
  assertSchema(version === 1 ? validators.skillV1 : validators.skillV2, value, path);
}
function validatePluginDocument(value, path) {
  assertSchema(validators.plugin, value, path);
}

// ../../runtime/plugins/schema.ts
var PluginSchemaError = class extends Error {
  constructor(message, path = "$") {
    super(`${path}: ${message}`);
    this.name = "PluginSchemaError";
    this.path = path;
  }
};
var ALLOWED_SCHEMA_KEYS2 = /* @__PURE__ */ new Set([
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
var JSON_SCHEMA_TYPES = /* @__PURE__ */ new Set(["null", "boolean", "number", "integer", "string", "array", "object"]);
function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function assertJsonSchemaDefinition(schema, path = "$schema", depth = 0) {
  if (depth > 24) throw new PluginSchemaError("Schema \u5D4C\u5957\u8FC7\u6DF1", path);
  if (!object(schema)) throw new PluginSchemaError("Schema \u5FC5\u987B\u662F\u5BF9\u8C61", path);
  for (const key of Object.keys(schema)) if (!ALLOWED_SCHEMA_KEYS2.has(key)) throw new PluginSchemaError(`\u4E0D\u652F\u6301 Schema \u5173\u952E\u5B57 ${key}`, path);
  const types = Array.isArray(schema.type) ? schema.type : schema.type === void 0 ? [] : [schema.type];
  if (!types.length || types.some((type) => typeof type !== "string" || !JSON_SCHEMA_TYPES.has(type))) throw new PluginSchemaError("\u5FC5\u987B\u58F0\u660E\u652F\u6301\u7684 JSON type", `${path}.type`);
  if (new Set(types).size !== types.length) throw new PluginSchemaError("type \u4E0D\u80FD\u91CD\u590D", `${path}.type`);
  if (schema.pattern !== void 0) {
    if (typeof schema.pattern !== "string") throw new PluginSchemaError("pattern \u5FC5\u987B\u662F\u5B57\u7B26\u4E32", `${path}.pattern`);
    try {
      new RegExp(schema.pattern, "u");
    } catch {
      throw new PluginSchemaError("pattern \u5FC5\u987B\u662F\u6709\u6548\u6B63\u5219", `${path}.pattern`);
    }
  }
  if (schema.required !== void 0 && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string") || new Set(schema.required).size !== schema.required.length)) throw new PluginSchemaError("required \u5FC5\u987B\u662F\u552F\u4E00\u5B57\u7B26\u4E32\u6570\u7EC4", `${path}.required`);
  if (schema.additionalProperties !== void 0 && typeof schema.additionalProperties !== "boolean") throw new PluginSchemaError("additionalProperties \u5FC5\u987B\u662F\u5E03\u5C14\u503C", `${path}.additionalProperties`);
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) if (schema[key] !== void 0 && (!Number.isInteger(schema[key]) || Number(schema[key]) < 0)) throw new PluginSchemaError(`${key} \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570`, `${path}.${key}`);
  for (const key of ["minimum", "maximum"]) if (schema[key] !== void 0 && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) throw new PluginSchemaError(`${key} \u5FC5\u987B\u662F\u6709\u9650\u6570\u5B57`, `${path}.${key}`);
  if (schema.enum !== void 0) {
    if (!Array.isArray(schema.enum) || !schema.enum.length) throw new PluginSchemaError("enum \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4", `${path}.enum`);
    assertPluginValue(schema.enum, `${path}.enum`);
  }
  if (Object.hasOwn(schema, "const")) assertPluginValue(schema.const, `${path}.const`);
  if (schema.properties !== void 0) {
    if (!object(schema.properties)) throw new PluginSchemaError("properties \u5FC5\u987B\u662F\u5BF9\u8C61", `${path}.properties`);
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!object(child)) throw new PluginSchemaError("\u5C5E\u6027 Schema \u5FC5\u987B\u662F\u5BF9\u8C61", `${path}.properties.${key}`);
      assertJsonSchemaDefinition(child, `${path}.properties.${key}`, depth + 1);
    }
  }
  if (schema.items !== void 0) {
    if (!object(schema.items)) throw new PluginSchemaError("items \u5FC5\u987B\u662F\u5BF9\u8C61", `${path}.items`);
    assertJsonSchemaDefinition(schema.items, `${path}.items`, depth + 1);
  }
}
function assertPluginValue(value, path = "$", depth = 0) {
  if (depth > 32) throw new PluginSchemaError("\u503C\u5D4C\u5957\u8D85\u8FC7 32 \u5C42", path);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PluginSchemaError("\u6570\u5B57\u5FC5\u987B\u6709\u9650", path);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 1e4) throw new PluginSchemaError("\u6570\u7EC4\u8FC7\u957F", path);
    value.forEach((item, index) => assertPluginValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (object(value)) {
    for (const [key, item] of Object.entries(value)) assertPluginValue(item, `${path}.${key}`, depth + 1);
    return;
  }
  throw new PluginSchemaError("\u503C\u5FC5\u987B\u53EF\u5E8F\u5217\u5316\u4E3A JSON", path);
}

// ../../lib/ai-package.ts
var MAX_PROMPT_BYTES = 1024 * 1024;
var MAX_VARIABLES = 512;
var VARIABLE_PATTERN2 = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
var NODE_DEFAULTS = {
  START: { title: "\u5F00\u59CB", icon: "\u25B6", tone: "mint", note: "\u6D41\u7A0B\u5165\u53E3", outputVar: "" },
  INPUT: { title: "\u7528\u6237\u8F93\u5165", icon: "\u2328", tone: "blue", note: "input_value", outputVar: "input_value", config: { variable: "input_value" } },
  SKILL: { title: "\u8C03\u7528 Skill", icon: "\u2726", tone: "violet", note: "\u9009\u62E9\u4E00\u4E2A Skill", outputVar: "skill_output", config: { input: "{{user_input}}" } },
  WORKSPACE: { title: "Agent Workspace", icon: "\u25CE", tone: "cyan", note: "\u914D\u7F6E\u603B Agent", outputVar: "workspace_output" },
  CONDITION: { title: "\u6761\u4EF6\u5206\u652F", icon: "\u25C7", tone: "amber", note: "\u8BBE\u7F6E\u5224\u65AD\u6761\u4EF6", outputVar: "condition_result", config: { expression: "score >= 0.7" } },
  OUTPUT: { title: "\u8F93\u51FA", icon: "\u2197", tone: "green", note: "final_output", outputVar: "final_output", config: { template: "{{previous.output}}" } },
  HTTP: { title: "HTTP \u8BF7\u6C42", icon: "\u2301", tone: "slate", note: "GET https://", outputVar: "http_response", config: { method: "GET", url: "https://api.example.com" } }
};
function slug(name) {
  return name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "agent-project";
}
function buildAiPackageFiles(project, timestamp = (/* @__PURE__ */ new Date()).toISOString()) {
  const files = {};
  files["manifest.json"] = JSON.stringify({
    formatVersion: CURRENT_AI_FORMAT_VERSION,
    version: "1.0.0",
    format: "ai_package",
    id: slug(project.name),
    name: project.name,
    created_at: timestamp,
    updated_at: timestamp,
    author: { name: "AgComm User" },
    files: [],
    signature: null
  }, null, 2);
  files["flow/flow.json"] = JSON.stringify({
    entry: project.nodes.find((node2) => node2.type === "START")?.id || project.nodes[0]?.id,
    variables: Object.fromEntries(project.variables.map((item) => [item.name, item.defaultValue || null])),
    config: {
      timeoutMs: project.execution?.timeoutMs ?? 6e4,
      maxConcurrency: project.execution?.maxConcurrency ?? 3,
      onError: "stop",
      ...project.interaction ? { interaction: project.interaction } : {}
    },
    visualizations: project.visualizations,
    edges: project.edges,
    nodes: project.nodes.map((node2) => node2.id)
  }, null, 2);
  files["flow/variables.json"] = JSON.stringify({
    global: Object.fromEntries(project.variables.filter((item) => ["user_id", "session_id", "context"].includes(item.name)).map((item) => [item.name, item.defaultValue || null])),
    local: Object.fromEntries(project.variables.filter((item) => !["user_id", "session_id", "context"].includes(item.name)).map((item) => [item.name, item.defaultValue || null]))
  }, null, 2);
  files["flow/variable-definitions.json"] = JSON.stringify(project.variables, null, 2);
  for (const node2 of project.nodes) {
    files[`flow/nodes/${node2.id}.json`] = JSON.stringify({
      id: node2.id,
      title: node2.title,
      type: node2.type,
      skill_name: node2.type === "SKILL" ? String(node2.config?.skillId || node2.note.split(" \xB7 ")[0]) : void 0,
      workspace: node2.type === "WORKSPACE" ? node2.workspace : void 0,
      config: node2.config,
      output_var: node2.outputVar,
      position: { x: node2.x, y: node2.y },
      icon: node2.icon,
      tone: node2.tone,
      note: node2.note,
      timeoutMs: node2.timeoutMs ?? 3e4,
      retry: { maxAttempts: 2, delayMs: 500, backoff: "exponential" },
      onError: "stop"
    }, null, 2);
  }
  for (const skill of project.skills) {
    files[`skills/${skill.id}/config.json`] = JSON.stringify({ id: skill.id, version: "1.0.0", name: skill.name, description: skill.description, category: skill.category, tags: [], icon: "\u2726", permissions: [], plugin_ids: skill.pluginIds }, null, 2);
    files[`skills/${skill.id}/prompt/system.txt`] = skill.prompt;
    files[`skills/${skill.id}/prompt/user.txt`] = "{{user_input}}";
  }
  for (const plugin2 of project.plugins) {
    const packageFiles = pluginPackageFiles(plugin2);
    for (const [path, content] of Object.entries(packageFiles)) files[`plugins/${plugin2.id}/${path}`] = content;
  }
  return files;
}
function parseJson(text2, path, required = true) {
  if (text2 === void 0) {
    if (!required) return void 0;
    throw new AiPackageValidationError("MISSING_FILE", "parse", `.ai \u5305\u7F3A\u5C11 ${path}`, [{ code: "MISSING_FILE", path, message: "\u7F3A\u5C11\u5FC5\u9700\u6587\u4EF6" }]);
  }
  try {
    return JSON.parse(text2);
  } catch (error) {
    throw new AiPackageValidationError("INVALID_JSON", "parse", `${path} \u4E0D\u662F\u6709\u6548 JSON\uFF1A${error instanceof Error ? error.message : "\u89E3\u6790\u5931\u8D25"}`, [{ code: "INVALID_JSON", path, message: "JSON \u89E3\u6790\u5931\u8D25" }]);
  }
}
function asObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiPackageValidationError("EXPECTED_OBJECT", "parse", `${path} \u5FC5\u987B\u662F JSON \u5BF9\u8C61`, [{ code: "EXPECTED_OBJECT", path, message: "\u5FC5\u987B\u662F\u5BF9\u8C61" }]);
  return value;
}
function detectFormatVersion(manifest) {
  const raw = manifest.formatVersion ?? manifest.format_version;
  if (raw === void 0) return 1;
  if (raw === 1 || raw === "1" || raw === "1.0.0") return 1;
  if (raw === 2 || raw === "2" || raw === "2.0.0") return 2;
  throw new AiPackageValidationError("UNSUPPORTED_FORMAT_VERSION", "version", `\u4E0D\u652F\u6301\u7684 .ai formatVersion\uFF1A${String(raw)}`, [{ code: "UNSUPPORTED_FORMAT_VERSION", path: "manifest.json", jsonPointer: "/formatVersion", message: `\u4E0D\u652F\u6301\u7248\u672C ${String(raw)}` }]);
}
function parseZipDocument(files) {
  const manifest = asObject(parseJson(files["manifest.json"], "manifest.json"), "manifest.json");
  const sourceVersion = detectFormatVersion(manifest);
  const flow2 = asObject(parseJson(files["flow/flow.json"], "flow/flow.json"), "flow/flow.json");
  validateManifest(manifest, sourceVersion);
  validateFlowDocument(flow2);
  const nodes = /* @__PURE__ */ new Map();
  for (const path of Object.keys(files).filter((name) => /^flow\/nodes\/[^/]+\.json$/.test(name))) {
    const id = path.slice("flow/nodes/".length, -".json".length);
    nodes.set(id, asObject(parseJson(files[path], path), path));
  }
  const skills = /* @__PURE__ */ new Map();
  for (const path of Object.keys(files).filter((name) => /^skills\/[^/]+\/config\.json$/.test(name))) {
    const id = path.split("/")[1];
    skills.set(id, asObject(parseJson(files[path], path), path));
  }
  const plugins = /* @__PURE__ */ new Map();
  for (const path of Object.keys(files).filter((name) => /^plugins\/[^/]+\/(?:agent-plugin|manifest)\.json$/.test(name)).sort((left, right) => left.includes("agent-plugin") ? -1 : right.includes("agent-plugin") ? 1 : 0)) {
    const id = path.split("/")[1];
    if (!plugins.has(id)) plugins.set(id, asObject(parseJson(files[path], path), path));
  }
  for (const [id, value] of nodes) validateNodeDocument(value, `flow/nodes/${id}.json`);
  for (const [id, value] of skills) validateSkillDocument(value, `skills/${id}/config.json`, sourceVersion);
  for (const [id, value] of plugins) validatePluginDocument(value, `plugins/${id}/manifest.json`);
  return { sourceVersion, manifest, flow: flow2, nodes, skills, plugins, files };
}
function migrateV1ToV2(document) {
  const skills = new Map([...document.skills].map(([id, config]) => [id, { ...config, id, version: config.version ?? "1.0.0" }]));
  return { ...document, sourceVersion: 2, manifest: { ...document.manifest, formatVersion: CURRENT_AI_FORMAT_VERSION }, skills };
}
function validateV2Document(document) {
  validateManifest(document.manifest, 2);
  validateFlowDocument(document.flow);
  for (const [id, value] of document.nodes) validateNodeDocument(value, `flow/nodes/${id}.json`);
  for (const [id, value] of document.skills) validateSkillDocument(value, `skills/${id}/config.json`, 2);
  for (const [id, value] of document.plugins) validatePluginDocument(value, `plugins/${id}/manifest.json`);
  validateReferences(document);
}
function validateReferences(document) {
  const issues = [];
  const listedNodeIds = document.flow.nodes;
  const nodeIds = new Set(listedNodeIds);
  const skillIds = new Set(document.skills.keys());
  const pluginIds = new Set(document.plugins.keys());
  const add = (code, path, message, jsonPointer) => issues.push({ code, path, message, jsonPointer });
  for (const id of listedNodeIds) if (!document.nodes.has(id)) add("MISSING_NODE_FILE", `flow/nodes/${id}.json`, `flow.nodes \u5F15\u7528\u7684\u8282\u70B9 ${id} \u4E0D\u5B58\u5728`);
  for (const id of document.nodes.keys()) if (!nodeIds.has(id)) add("ORPHAN_NODE_FILE", `flow/nodes/${id}.json`, `\u8282\u70B9 ${id} \u672A\u5728 flow.nodes \u4E2D\u58F0\u660E`);
  for (const [pathId, node2] of document.nodes) {
    if (node2.id !== pathId) add("NODE_ID_MISMATCH", `flow/nodes/${pathId}.json`, `\u8282\u70B9 ID ${String(node2.id)} \u4E0E\u6587\u4EF6\u540D ${pathId} \u4E0D\u4E00\u81F4`, "/id");
    const type = node2.type;
    if (type === "SKILL") {
      const config = node2.config;
      const skillId = String(config?.skillId ?? node2.skill_name ?? "");
      if (!skillIds.has(skillId)) add("MISSING_SKILL_REFERENCE", `flow/nodes/${pathId}.json`, `\u8282\u70B9\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684 Skill ${skillId}`, "/skill_name");
    }
    if (type === "WORKSPACE") {
      const workspace = node2.workspace;
      if (!skillIds.has(workspace.agentSkillId)) add("MISSING_AGENT_SKILL", `flow/nodes/${pathId}.json`, `Workspace \u603B Agent Skill ${workspace.agentSkillId} \u4E0D\u5B58\u5728`, "/workspace/agentSkillId");
      if (workspace.skillIds.includes(workspace.agentSkillId)) add("AGENT_SKILL_REUSED", `flow/nodes/${pathId}.json`, "\u603B Agent Skill \u4E0D\u80FD\u540C\u65F6\u51FA\u73B0\u5728\u53EF\u8C03\u7528 Skills \u4E2D", "/workspace/skillIds");
      for (const skillId of workspace.skillIds) if (!skillIds.has(skillId)) add("MISSING_WORKSPACE_SKILL", `flow/nodes/${pathId}.json`, `Workspace \u53EF\u8C03\u7528 Skill ${skillId} \u4E0D\u5B58\u5728`, "/workspace/skillIds");
    }
  }
  for (const [pathId, skill] of document.skills) {
    if (skill.id !== pathId) add("SKILL_ID_MISMATCH", `skills/${pathId}/config.json`, `Skill ID ${String(skill.id)} \u4E0E\u76EE\u5F55 ${pathId} \u4E0D\u4E00\u81F4`, "/id");
    for (const pluginId of skill.plugin_ids) if (!pluginIds.has(pluginId)) add("MISSING_PLUGIN_REFERENCE", `skills/${pathId}/config.json`, `Skill \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684 Plugin ${pluginId}`, "/plugin_ids");
    const promptPath = `skills/${pathId}/prompt/system.txt`;
    const prompt = document.files[promptPath];
    if (prompt === void 0) add("MISSING_SKILL_PROMPT", promptPath, "Skill \u7F3A\u5C11 System Prompt");
    else if (new TextEncoder().encode(prompt).length > MAX_PROMPT_BYTES || prompt.includes("\0")) add("INVALID_SKILL_PROMPT", promptPath, "System Prompt \u8D85\u8FC7 1 MiB \u6216\u5305\u542B NUL");
  }
  for (const [pathId, plugin2] of document.plugins) {
    const manifestPath = plugin2.sdkVersion ? `plugins/${pathId}/agent-plugin.json` : `plugins/${pathId}/manifest.json`;
    if (plugin2.id !== pathId) add("PLUGIN_ID_MISMATCH", manifestPath, `Plugin ID ${String(plugin2.id)} \u4E0E\u76EE\u5F55 ${pathId} \u4E0D\u4E00\u81F4`, "/id");
    if (plugin2.sdkVersion) {
      for (const relative of ["package.json", "src/index.ts", "dist/index.js", "README.md"]) {
        const path = `plugins/${pathId}/${relative}`;
        const content = document.files[path];
        if (content === void 0) add("MISSING_PLUGIN_FILE", path, `TypeScript Plugin \u7F3A\u5C11 ${relative}`);
        else if (!content.trim()) add("EMPTY_PLUGIN_FILE", path, `TypeScript Plugin \u7684 ${relative} \u4E0D\u80FD\u4E3A\u7A7A`);
      }
      const packageJsonPath = `plugins/${pathId}/package.json`;
      try {
        const packageJson = JSON.parse(document.files[packageJsonPath] ?? "{}");
        if (packageJson.version !== plugin2.version) add("PLUGIN_VERSION_MISMATCH", packageJsonPath, "package.json version \u4E0E Plugin manifest \u4E0D\u4E00\u81F4", "/version");
      } catch {
        add("INVALID_PLUGIN_PACKAGE_JSON", packageJsonPath, "package.json \u4E0D\u662F\u6709\u6548 JSON");
      }
      const toolNames = /* @__PURE__ */ new Set();
      for (const [index, rawTool] of (plugin2.tools ?? []).entries()) {
        const toolName = String(rawTool.name ?? "");
        if (toolNames.has(toolName)) add("DUPLICATE_PLUGIN_TOOL", manifestPath, `Plugin Tool ${toolName} \u91CD\u590D`, `/tools/${index}/name`);
        toolNames.add(toolName);
        for (const permission of rawTool.permissions ?? []) if (!plugin2.permissions.includes(permission)) add("UNDECLARED_TOOL_PERMISSION", manifestPath, `Tool ${toolName} \u4F7F\u7528\u4E86\u672A\u58F0\u660E\u6743\u9650 ${permission}`, `/tools/${index}/permissions`);
      }
    }
  }
  const entry = String(document.flow.entry);
  const entryNode = document.nodes.get(entry);
  if (!entryNode) add("MISSING_ENTRY", "flow/flow.json", `\u5165\u53E3\u8282\u70B9 ${entry} \u4E0D\u5B58\u5728`, "/entry");
  else if (entryNode.type !== "START") add("INVALID_ENTRY_TYPE", "flow/flow.json", "\u5165\u53E3\u8282\u70B9\u5FC5\u987B\u662F START", "/entry");
  const edgeKeys = /* @__PURE__ */ new Set();
  for (const [index, raw] of document.flow.edges.entries()) {
    const from = String(raw.from);
    const to = String(raw.to);
    if (!nodeIds.has(from) || !nodeIds.has(to)) add("DANGLING_EDGE", "flow/flow.json", `\u8FB9 ${from} \u2192 ${to} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u8282\u70B9`, `/edges/${index}`);
    const key = JSON.stringify([from, to, raw.label ?? "", raw.condition ?? ""]);
    if (edgeKeys.has(key)) add("DUPLICATE_EDGE", "flow/flow.json", `\u91CD\u590D\u8FB9 ${from} \u2192 ${to}`, `/edges/${index}`);
    edgeKeys.add(key);
  }
  if (issues.length) throw new AiPackageValidationError("REFERENCE_INVALID", "validate", `${issues[0].path}\uFF1A${issues[0].message}`, issues);
}
function validateVariableDefinitions(value) {
  if (!Array.isArray(value) || value.length > MAX_VARIABLES) throw new AiPackageValidationError("INVALID_VARIABLES", "validate", "flow/variable-definitions.json \u5FC5\u987B\u662F\u6700\u591A 512 \u9879\u7684\u6570\u7EC4");
  const names = /* @__PURE__ */ new Set();
  return value.map((item, index) => {
    const path = `flow/variable-definitions.json/${index}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new AiPackageValidationError("INVALID_VARIABLE", "validate", `${path} \u5FC5\u987B\u662F\u5BF9\u8C61`);
    const raw = item;
    if (typeof raw.name !== "string" || !VARIABLE_PATTERN2.test(raw.name) || names.has(raw.name)) throw new AiPackageValidationError("INVALID_VARIABLE", "validate", `${path} \u7684\u53D8\u91CF\u540D\u975E\u6CD5\u6216\u91CD\u590D`);
    if (!["string", "number", "boolean", "array", "object", "markdown"].includes(String(raw.type))) throw new AiPackageValidationError("INVALID_VARIABLE", "validate", `${path} \u7684\u53D8\u91CF\u7C7B\u578B\u65E0\u6548`);
    if (typeof raw.defaultValue !== "string" || raw.defaultValue.length > 65536) throw new AiPackageValidationError("INVALID_VARIABLE", "validate", `${path} \u7684\u9ED8\u8BA4\u503C\u65E0\u6548`);
    names.add(raw.name);
    return { name: raw.name, type: raw.type, defaultValue: raw.defaultValue };
  });
}
function variablesFromFiles(document) {
  const definitions = parseJson(document.files["flow/variable-definitions.json"], "flow/variable-definitions.json", false);
  if (definitions !== void 0) return validateVariableDefinitions(definitions);
  const variablesFile = asObject(parseJson(document.files["flow/variables.json"], "flow/variables.json"), "flow/variables.json");
  const global = variablesFile.global && typeof variablesFile.global === "object" && !Array.isArray(variablesFile.global) ? variablesFile.global : {};
  const local = variablesFile.local && typeof variablesFile.local === "object" && !Array.isArray(variablesFile.local) ? variablesFile.local : {};
  const duplicateScopeName = Object.keys(global).find((name) => Object.prototype.hasOwnProperty.call(local, name));
  if (duplicateScopeName) throw new AiPackageValidationError("DUPLICATE_VARIABLE", "validate", `\u53D8\u91CF ${duplicateScopeName} \u540C\u65F6\u51FA\u73B0\u5728 global \u548C local \u4F5C\u7528\u57DF`);
  const source = { ...global, ...local };
  if (Object.keys(source).length > MAX_VARIABLES) throw new AiPackageValidationError("INVALID_VARIABLES", "validate", "\u53D8\u91CF\u6570\u91CF\u8D85\u8FC7 512");
  return Object.entries(source).map(([name, value]) => {
    if (!VARIABLE_PATTERN2.test(name)) throw new AiPackageValidationError("INVALID_VARIABLE", "validate", `\u53D8\u91CF\u540D ${name} \u975E\u6CD5`);
    return { name, type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : typeof value === "object" && value !== null ? Array.isArray(value) ? "array" : "object" : "string", defaultValue: value == null ? "" : typeof value === "string" ? value : JSON.stringify(value) };
  });
}
function normalizeV2(document, fallbackName) {
  const flowConfig = document.flow.config && typeof document.flow.config === "object" && !Array.isArray(document.flow.config) ? document.flow.config : {};
  const nodes = [...document.nodes.values()].map((raw) => {
    const position = raw.position;
    const workspace = raw.workspace;
    const defaults = NODE_DEFAULTS[String(raw.type)];
    return {
      id: raw.id,
      type: raw.type,
      title: raw.title,
      icon: raw.icon || defaults.icon,
      tone: raw.tone || defaults.tone,
      note: raw.note || defaults.note,
      x: position.x,
      y: position.y,
      outputVar: raw.output_var,
      config: raw.config,
      workspace: raw.type === "WORKSPACE" ? workspace : void 0,
      ...typeof raw.timeoutMs === "number" ? { timeoutMs: raw.timeoutMs } : {}
    };
  });
  const skills = [...document.skills].map(([id, config]) => ({
    id,
    name: config.name,
    description: config.description,
    category: config.category,
    prompt: document.files[`skills/${id}/prompt/system.txt`],
    pluginIds: config.plugin_ids
  }));
  const plugins = [...document.plugins.values()].map((config) => {
    const id = config.id;
    if (config.sdkVersion) return validatePlugin({
      id,
      name: config.name,
      description: config.description,
      version: config.version,
      sdkVersion: "1",
      language: "typescript",
      entry: "dist/index.js",
      runtime: config.runtime === "server" ? "server" : "player",
      source: "custom",
      ...config.author && typeof config.author === "object" ? { author: config.author } : {},
      ...typeof config.license === "string" ? { license: config.license } : {},
      ...typeof config.homepage === "string" ? { homepage: config.homepage } : {},
      permissions: config.permissions,
      tools: Array.isArray(config.tools) ? config.tools : [{ name: "run", description: String(config.description || `\u8FD0\u884C ${String(config.name)}`), permissions: config.permissions }],
      ...config.limits && typeof config.limits === "object" ? { limits: config.limits } : {},
      ...typeof config.integrity === "string" ? { integrity: config.integrity } : {},
      ...config.signature && typeof config.signature === "object" ? { signature: config.signature } : {},
      packageJson: document.files[`plugins/${id}/package.json`],
      tsconfigJson: document.files[`plugins/${id}/tsconfig.json`] ?? createPluginScaffold(id, config.name).tsconfigJson,
      sourceCode: document.files[`plugins/${id}/src/index.ts`],
      bundleCode: document.files[`plugins/${id}/dist/index.js`],
      readme: document.files[`plugins/${id}/README.md`]
    });
    const scaffold = createPluginScaffold(id, config.name);
    return {
      ...scaffold,
      description: config.description,
      version: config.version,
      permissions: config.permissions.filter((permission) => /^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$/.test(permission))
    };
  });
  const edges = document.flow.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    ...edge.id !== void 0 ? { id: edge.id } : {},
    ...edge.label !== void 0 ? { label: edge.label } : {},
    ...edge.condition !== void 0 ? { condition: edge.condition } : {}
  }));
  return {
    name: String(document.manifest.name || document.manifest.id || fallbackName),
    nodes,
    edges,
    skills,
    plugins,
    execution: {
      timeoutMs: typeof flowConfig.timeoutMs === "number" ? flowConfig.timeoutMs : 6e4,
      maxConcurrency: typeof flowConfig.maxConcurrency === "number" ? flowConfig.maxConcurrency : 3
    },
    ...flowConfig.interaction && typeof flowConfig.interaction === "object" && !Array.isArray(flowConfig.interaction) ? { interaction: structuredClone(flowConfig.interaction) } : {},
    variables: variablesFromFiles(document),
    visualizations: document.flow.visualizations ?? []
  };
}
function migrateLegacyProject(parsed, fallbackName) {
  validateLegacyProject(parsed);
  const nodes = /* @__PURE__ */ new Map();
  for (const [index, item] of parsed.nodes.entries()) {
    const type = item.type;
    const defaults = NODE_DEFAULTS[type];
    const id = item.id;
    const config = item.config && typeof item.config === "object" && !Array.isArray(item.config) ? item.config : defaults.config ?? {};
    const skillId = type === "SKILL" ? String(config.skillId ?? item.skill_name ?? "") : void 0;
    nodes.set(id, {
      id,
      title: item.title ?? defaults.title,
      type,
      ...skillId ? { skill_name: skillId } : {},
      ...type === "WORKSPACE" ? { workspace: item.workspace } : {},
      config,
      output_var: item.outputVar ?? item.output_var ?? defaults.outputVar,
      position: { x: item.x ?? 90 + index * 190, y: item.y ?? 180 },
      icon: item.icon ?? defaults.icon,
      tone: item.tone ?? defaults.tone,
      note: item.note ?? defaults.note,
      timeoutMs: 3e4,
      retry: { maxAttempts: 2, delayMs: 500, backoff: "exponential" },
      onError: "stop"
    });
  }
  const skills = /* @__PURE__ */ new Map();
  const files = {};
  for (const item of parsed.skills ?? []) {
    const id = item.id;
    skills.set(id, { id, version: "1.0.0", name: item.name, description: item.description ?? "", category: item.category ?? "\u672A\u5206\u7C7B", tags: [], icon: "\u2726", permissions: [], plugin_ids: item.pluginIds ?? [] });
    files[`skills/${id}/prompt/system.txt`] = String(item.prompt ?? "");
  }
  const plugins = /* @__PURE__ */ new Map();
  for (const item of parsed.plugins ?? []) plugins.set(item.id, { ...item, source: item.source ?? "custom" });
  files["flow/variable-definitions.json"] = JSON.stringify(parsed.variables ?? []);
  const name = typeof parsed.name === "string" ? parsed.name : fallbackName;
  return {
    sourceVersion: 2,
    manifest: { formatVersion: 2, format: "ai_package", id: slug(name), name, version: "1.0.0", files: [], signature: null },
    flow: { entry: [...nodes.values()].find((node2) => node2.type === "START")?.id ?? nodes.keys().next().value, nodes: [...nodes.keys()], edges: parsed.edges ?? [], variables: {}, visualizations: parsed.visualizations ?? [], config: { timeoutMs: 6e4, maxConcurrency: 3, onError: "stop" } },
    nodes,
    skills,
    plugins,
    files
  };
}
async function importAiPackage(buffer, fallbackName = "agent-project") {
  if (buffer.byteLength > AI_PACKAGE_LIMITS.archiveBytes) throw new AiPackageZipError("ARCHIVE_TOO_LARGE", `.ai \u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 ${AI_PACKAGE_LIMITS.archiveBytes} bytes`);
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 80 || bytes[1] !== 75) {
    const parsed2 = asObject(parseJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "legacy.json"), "legacy.json");
    const document = migrateLegacyProject(parsed2, fallbackName);
    validateV2Document(document);
    return { project: normalizeV2(document, fallbackName), sourceVersion: 0, targetVersion: 2, migrated: true, migrations: ["legacy-json \u2192 v1", "v1 \u2192 v2"] };
  }
  const files = await readZip(buffer);
  const parsed = parseZipDocument(files);
  const sourceVersion = parsed.sourceVersion;
  const current = sourceVersion === 1 ? migrateV1ToV2(parsed) : parsed;
  validateV2Document(current);
  return { project: normalizeV2(current, fallbackName), sourceVersion, targetVersion: 2, migrated: sourceVersion !== 2, migrations: sourceVersion === 1 ? ["v1 \u2192 v2"] : [] };
}
async function parseAiPackage(buffer, fallbackName = "agent-project") {
  return (await importAiPackage(buffer, fallbackName)).project;
}

// ../../lib/background-schedule.ts
var FIELDS2 = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7, sunday: true }
];
function fieldValue2(raw, field) {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid Cron value: ${raw}`);
  const value = Number(raw);
  if (value < field.min || value > field.max) throw new Error(`Cron value out of range: ${raw}`);
  return field.sunday && value === 7 ? 0 : value;
}
function parseField2(source, field) {
  const values = /* @__PURE__ */ new Set();
  for (const part of source.split(",")) {
    if (!part) throw new Error("Cron field contains an empty list item");
    const [rangeSource, stepSource, extra] = part.split("/");
    if (extra !== void 0) throw new Error(`Invalid Cron step: ${part}`);
    const step = stepSource === void 0 ? 1 : Number(stepSource);
    if (!Number.isInteger(step) || step < 1 || step > field.max - field.min + 1) throw new Error(`Invalid Cron step: ${part}`);
    let start = field.min;
    let end = field.max;
    if (rangeSource !== "*") {
      const range = rangeSource.split("-");
      if (range.length > 2) throw new Error(`Invalid Cron range: ${part}`);
      start = fieldValue2(range[0], field);
      end = range.length === 2 ? fieldValue2(range[1], field) : start;
      if (field.sunday && range.length === 2 && range[1] === "7") end = 7;
      if (start > end) throw new Error(`Descending Cron range is not supported: ${part}`);
    }
    for (let value = start; value <= end; value += step) values.add(field.sunday && value === 7 ? 0 : value);
  }
  return values;
}
function parseCronExpression2(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must contain exactly five fields");
  const parsed = parts.map((part, index) => parseField2(part, FIELDS2[index]));
  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
    anyDayOfMonth: parts[2] === "*",
    anyDayOfWeek: parts[4] === "*"
  };
}
function assertTimeZone2(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch (error) {
    throw new Error(`Invalid IANA timezone: ${timezone}`, { cause: error });
  }
}

// ../../lib/ai-package-v5-format.ts
function parseJson2(text2, path) {
  if (text2 === void 0) throw new AiPackageValidationError("MISSING_FILE", "parse", `.ai \u5305\u7F3A\u5C11 ${path}`);
  try {
    const value = JSON.parse(text2);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object");
    return value;
  } catch (error) {
    throw new AiPackageValidationError("INVALID_JSON", "parse", `${path} \u4E0D\u662F\u6709\u6548 JSON`, [{ code: "INVALID_JSON", path, message: error instanceof Error ? error.message : "JSON parse failed" }]);
  }
}
function codeTool(plugin2) {
  const tools = Array.isArray(plugin2.tools) ? plugin2.tools : [];
  return tools.find((tool) => tool && typeof tool === "object" && tool.name === "run");
}
function validateV5References(files, flow2, nodes, plugins) {
  const issues = [];
  const background = flow2.config?.background;
  if (background) {
    if (!background.heartbeat && (!Array.isArray(background.cron) || background.cron.length === 0)) {
      issues.push({ code: "BACKGROUND_TRIGGER_REQUIRED", path: "flow/flow.json", jsonPointer: "/config/background", message: "background \u81F3\u5C11\u9700\u8981 heartbeat \u6216 cron \u89E6\u53D1\u5668" });
    }
    const triggerIds = /* @__PURE__ */ new Set();
    const validateTriggerId = (id, path) => {
      const value = String(id ?? "");
      if (triggerIds.has(value)) issues.push({ code: "DUPLICATE_BACKGROUND_TRIGGER", path: "flow/flow.json", jsonPointer: path, message: `\u540E\u53F0\u89E6\u53D1\u5668 ID ${value} \u91CD\u590D` });
      triggerIds.add(value);
    };
    const heartbeat = background.heartbeat;
    if (heartbeat) validateTriggerId(heartbeat.id, "/config/background/heartbeat/id");
    for (const [index, value] of (Array.isArray(background.cron) ? background.cron : []).entries()) {
      const trigger = value;
      validateTriggerId(trigger.id, `/config/background/cron/${index}/id`);
      try {
        parseCronExpression2(String(trigger.expression));
        assertTimeZone2(String(trigger.timezone));
      } catch (error) {
        issues.push({ code: "INVALID_CRON", path: "flow/flow.json", jsonPointer: `/config/background/cron/${index}`, message: error instanceof Error ? error.message : "Cron \u914D\u7F6E\u65E0\u6548" });
      }
    }
  }
  const listed = Array.isArray(flow2.nodes) ? flow2.nodes.map(String) : [];
  for (const id of listed) if (!nodes.has(id)) issues.push({ code: "MISSING_NODE_FILE", path: `flow/nodes/${id}.json`, message: `\u8282\u70B9 ${id} \u4E0D\u5B58\u5728` });
  for (const [id, node2] of nodes) {
    if (!listed.includes(id)) issues.push({ code: "ORPHAN_NODE_FILE", path: `flow/nodes/${id}.json`, message: `\u8282\u70B9 ${id} \u672A\u5728 flow.nodes \u4E2D\u58F0\u660E` });
    if (node2.id !== id) issues.push({ code: "NODE_ID_MISMATCH", path: `flow/nodes/${id}.json`, message: `\u8282\u70B9 ID \u4E0E\u6587\u4EF6\u540D\u4E0D\u4E00\u81F4` });
    if (node2.type === "CONTACT" && !flow2.config?.background) {
      issues.push({ code: "CONTACT_REQUIRES_BACKGROUND", path: `flow/nodes/${id}.json`, message: "CONTACT \u8282\u70B9\u8981\u6C42\u5E94\u7528\u58F0\u660E background" });
    }
    if (node2.type !== "CODE") continue;
    const config = node2.config;
    const codeId = String(node2.code_id ?? "");
    if (String(config.codeId ?? "") !== codeId) issues.push({ code: "CODE_ID_MISMATCH", path: `flow/nodes/${id}.json`, message: "code_id \u4E0E config.codeId \u4E0D\u4E00\u81F4" });
    const plugin2 = plugins.get(codeId);
    if (!plugin2) {
      issues.push({ code: "MISSING_CODE_BUNDLE", path: `flow/nodes/${id}.json`, message: `Code bundle ${codeId} \u4E0D\u5B58\u5728` });
      continue;
    }
    const tool = codeTool(plugin2);
    if (!tool?.inputSchema || !tool.outputSchema) {
      issues.push({ code: "INVALID_CODE_SCHEMA", path: `plugins/${codeId}/agent-plugin.json`, message: "Code run \u5FC5\u987B\u58F0\u660E inputSchema \u548C outputSchema" });
    } else {
      try {
        assertJsonSchemaDefinition(tool.inputSchema, `plugins/${codeId}/inputSchema`);
        assertJsonSchemaDefinition(tool.outputSchema, `plugins/${codeId}/outputSchema`);
        const outputTypes = (Array.isArray(tool.outputSchema.type) ? tool.outputSchema.type : [tool.outputSchema.type]).filter((type) => type !== "null");
        if (outputTypes.length !== 1) throw new Error("outputSchema must contain exactly one non-null type");
      } catch (error) {
        issues.push({ code: "INVALID_CODE_SCHEMA", path: `plugins/${codeId}/agent-plugin.json`, message: error instanceof Error ? error.message : "Code Schema \u65E0\u6548" });
      }
    }
  }
  const nodeIds = new Set(nodes.keys());
  for (const [index, raw] of (Array.isArray(flow2.edges) ? flow2.edges : []).entries()) {
    const edge = raw;
    if (!nodeIds.has(String(edge.from)) || !nodeIds.has(String(edge.to))) issues.push({ code: "DANGLING_EDGE", path: "flow/flow.json", jsonPointer: `/edges/${index}`, message: "\u8FB9\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u8282\u70B9" });
  }
  if (issues.length) throw new AiPackageValidationError("REFERENCE_INVALID", "validate", `${issues[0].path}\uFF1A${issues[0].message}`, issues);
  void files;
}
function buildAiPackageV5Files(project, timestamp) {
  const files = buildAiPackageFiles(project, timestamp);
  const manifest = parseJson2(files["manifest.json"], "manifest.json");
  files["manifest.json"] = JSON.stringify({
    ...manifest,
    formatVersion: 5,
    id: project.appId ?? manifest.id,
    version: project.appVersion ?? manifest.version
  }, null, 2);
  const flow2 = parseJson2(files["flow/flow.json"], "flow/flow.json");
  const config = flow2.config && typeof flow2.config === "object" && !Array.isArray(flow2.config) ? flow2.config : {};
  files["flow/flow.json"] = JSON.stringify({ ...flow2, config: { ...config, ...project.background ? { background: project.background } : {} } }, null, 2);
  for (const node2 of project.nodes) {
    if (node2.type !== "CODE") continue;
    const path = `flow/nodes/${node2.id}.json`;
    const document = parseJson2(files[path], path);
    files[path] = JSON.stringify({ ...document, code_id: String(node2.config?.codeId ?? ""), retry: { maxAttempts: 1, delayMs: 0, backoff: "fixed" } }, null, 2);
  }
  return files;
}
async function parseAiPackageV5(buffer, fallbackName = "agent-project") {
  const files = await readZip(buffer);
  const manifest = parseJson2(files["manifest.json"], "manifest.json");
  assertSchema(manifestV5, manifest, "manifest.json");
  const flow2 = parseJson2(files["flow/flow.json"], "flow/flow.json");
  assertSchema(flowV5, flow2, "flow/flow.json");
  const nodes = /* @__PURE__ */ new Map();
  for (const path of Object.keys(files).filter((name) => /^flow\/nodes\/[^/]+\.json$/.test(name))) {
    const id = path.slice("flow/nodes/".length, -5);
    const node2 = parseJson2(files[path], path);
    assertSchema(nodeV5, node2, path);
    nodes.set(id, node2);
  }
  const plugins = /* @__PURE__ */ new Map();
  for (const path of Object.keys(files).filter((name) => /^plugins\/[^/]+\/agent-plugin\.json$/.test(name))) {
    const id = path.split("/")[1];
    const plugin2 = parseJson2(files[path], path);
    assertSchema(pluginV5, plugin2, path);
    plugins.set(id, plugin2);
  }
  for (const path of Object.keys(files).filter((name) => /^skills\/[^/]+\/config\.json$/.test(name))) validateSkillDocument(parseJson2(files[path], path), path, 2);
  validateV5References(files, flow2, nodes, plugins);
  const compatible = { ...files };
  compatible["manifest.json"] = JSON.stringify({ ...manifest, formatVersion: 2 });
  const compatibleFlow = structuredClone(flow2);
  if (compatibleFlow.config && typeof compatibleFlow.config === "object" && !Array.isArray(compatibleFlow.config)) delete compatibleFlow.config.background;
  compatible["flow/flow.json"] = JSON.stringify(compatibleFlow);
  for (const [id, node2] of nodes) {
    if (node2.type === "CODE") {
      const { code_id: _codeId, ...rest } = node2;
      compatible[`flow/nodes/${id}.json`] = JSON.stringify({ ...rest, type: "HTTP" });
    } else if (node2.type === "CONTACT") {
      compatible[`flow/nodes/${id}.json`] = JSON.stringify({ ...node2, type: "HTTP", config: { method: "POST", url: "https://example.invalid/contact" } });
    }
  }
  for (const [id, plugin2] of plugins) {
    compatible[`plugins/${id}/agent-plugin.json`] = JSON.stringify({ ...plugin2, runtime: "player" });
  }
  const archive = createZip(compatible);
  const normalized = await parseAiPackage(await archive.arrayBuffer(), fallbackName);
  const nodeTypes = new Map([...nodes].filter(([, node2]) => node2.type === "CODE" || node2.type === "CONTACT").map(([id, node2]) => [id, node2.type]));
  const restored = normalized.nodes.map((node2) => nodeTypes.has(node2.id) ? { ...node2, type: nodeTypes.get(node2.id), config: nodes.get(node2.id)?.config } : node2);
  const restoredPlugins = normalized.plugins.map((plugin2) => plugins.has(plugin2.id) ? { ...plugin2, runtime: "runtime" } : plugin2);
  const background = flow2.config?.background;
  return {
    ...normalized,
    appId: String(manifest.id),
    appVersion: String(manifest.version),
    ...background ? { background } : {},
    formatVersion: 5,
    nodes: restored,
    plugins: restoredPlugins
  };
}

// ../../lib/ai-package-v6-format.ts
var HOOK_OPERATIONS = /* @__PURE__ */ new Set(["onStart", "beforeModel", "afterModel", "beforeTool", "afterTool", "onFinish", "onError"]);
function parseJson3(text2, path) {
  if (text2 === void 0) throw new AiPackageValidationError("MISSING_FILE", "parse", `.ai \u5305\u7F3A\u5C11 ${path}`);
  try {
    const value = JSON.parse(text2);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object");
    return value;
  } catch (error) {
    throw new AiPackageValidationError("INVALID_JSON", "parse", `${path} \u4E0D\u662F\u6709\u6548 JSON`, [{ code: "INVALID_JSON", path, message: error instanceof Error ? error.message : "JSON parse failed" }]);
  }
}
function validateV6References(flow2, nodes, plugins) {
  const issues = [];
  const codeIds = /* @__PURE__ */ new Set();
  const hookIds = /* @__PURE__ */ new Set();
  for (const [id, node2] of nodes) {
    if (node2.type === "CODE") codeIds.add(String(node2.code_id ?? node2.config?.codeId ?? ""));
    if (node2.type !== "WORKSPACE") continue;
    const config = node2.config;
    const references = Array.isArray(config?.hookIds) ? config.hookIds.map(String) : [];
    if (new Set(references).size !== references.length) issues.push({ code: "DUPLICATE_WORKSPACE_HOOK", path: `flow/nodes/${id}.json`, jsonPointer: "/config/hookIds", message: "Workspace Hook \u5F15\u7528\u91CD\u590D" });
    for (const hookId of references) {
      hookIds.add(hookId);
      const plugin2 = plugins.get(hookId);
      if (!plugin2) issues.push({ code: "MISSING_WORKSPACE_HOOK", path: `flow/nodes/${id}.json`, jsonPointer: "/config/hookIds", message: `Workspace Hook bundle ${hookId} \u4E0D\u5B58\u5728` });
      else if (plugin2.kind !== "workspace-hook") issues.push({ code: "WORKSPACE_HOOK_KIND_INVALID", path: `plugins/${hookId}/agent-plugin.json`, message: `${hookId} \u4E0D\u662F workspace-hook bundle` });
    }
  }
  for (const [id, plugin2] of plugins) {
    const kind = String(plugin2.kind ?? "");
    const tools = Array.isArray(plugin2.tools) ? plugin2.tools : [];
    const names = tools.map((tool) => String(tool.name ?? ""));
    if (new Set(names).size !== names.length) issues.push({ code: "DUPLICATE_BUNDLE_OPERATION", path: `plugins/${id}/agent-plugin.json`, message: `Bundle ${id} \u5B58\u5728\u91CD\u590D operation` });
    if (kind === "code" && !codeIds.has(id)) issues.push({ code: "ORPHAN_CODE_BUNDLE", path: `plugins/${id}/agent-plugin.json`, message: `Code bundle ${id} \u672A\u88AB CODE \u8282\u70B9\u5F15\u7528` });
    if (kind === "workspace-hook" && !hookIds.has(id)) issues.push({ code: "ORPHAN_WORKSPACE_HOOK", path: `plugins/${id}/agent-plugin.json`, message: `Workspace Hook ${id} \u672A\u88AB WORKSPACE \u8282\u70B9\u5F15\u7528` });
    if (codeIds.has(id) && kind !== "code") issues.push({ code: "CODE_BUNDLE_KIND_INVALID", path: `plugins/${id}/agent-plugin.json`, message: `CODE \u8282\u70B9\u5F15\u7528\u7684 ${id} \u5FC5\u987B\u58F0\u660E kind=code` });
    if (kind !== "workspace-hook") continue;
    for (const tool of tools) {
      const name = String(tool.name ?? "");
      if (!HOOK_OPERATIONS.has(name)) issues.push({ code: "WORKSPACE_HOOK_OPERATION_INVALID", path: `plugins/${id}/agent-plugin.json`, message: `\u672A\u77E5 Workspace Hook operation\uFF1A${name}` });
      try {
        assertJsonSchemaDefinition(tool.inputSchema, `plugins/${id}/${name}/inputSchema`);
        assertJsonSchemaDefinition(tool.outputSchema, `plugins/${id}/${name}/outputSchema`);
      } catch (error) {
        issues.push({ code: "WORKSPACE_HOOK_SCHEMA_INVALID", path: `plugins/${id}/agent-plugin.json`, message: error instanceof Error ? error.message : "Workspace Hook Schema \u65E0\u6548" });
      }
    }
  }
  const listed = Array.isArray(flow2.nodes) ? flow2.nodes.map(String) : [];
  for (const id of listed) if (!nodes.has(id)) issues.push({ code: "MISSING_NODE_FILE", path: `flow/nodes/${id}.json`, message: `\u8282\u70B9 ${id} \u4E0D\u5B58\u5728` });
  if (issues.length) throw new AiPackageValidationError("REFERENCE_INVALID", "validate", `${issues[0].path}\uFF1A${issues[0].message}`, issues);
}
function buildAiPackageV6Files(project, timestamp) {
  const files = buildAiPackageV5Files(project, timestamp);
  const manifest = parseJson3(files["manifest.json"], "manifest.json");
  files["manifest.json"] = JSON.stringify({ ...manifest, formatVersion: 6 }, null, 2);
  for (const plugin2 of project.plugins) {
    const path = `plugins/${plugin2.id}/agent-plugin.json`;
    const document = parseJson3(files[path], path);
    files[path] = JSON.stringify({ ...document, kind: plugin2.kind }, null, 2);
  }
  return files;
}
async function parseAiPackageV6(buffer, fallbackName = "agent-project") {
  const files = await readZip(buffer);
  const manifest = parseJson3(files["manifest.json"], "manifest.json");
  assertSchema(manifestV6, manifest, "manifest.json");
  const flow2 = parseJson3(files["flow/flow.json"], "flow/flow.json");
  assertSchema(flowV6, flow2, "flow/flow.json");
  const nodes = /* @__PURE__ */ new Map();
  for (const path of Object.keys(files).filter((name) => /^flow\/nodes\/[^/]+\.json$/.test(name))) {
    const id = path.slice("flow/nodes/".length, -5);
    const node2 = parseJson3(files[path], path);
    assertSchema(nodeV6, node2, path);
    nodes.set(id, node2);
  }
  const plugins = /* @__PURE__ */ new Map();
  for (const path of Object.keys(files).filter((name) => /^plugins\/[^/]+\/agent-plugin\.json$/.test(name))) {
    const id = path.split("/")[1];
    const plugin2 = parseJson3(files[path], path);
    assertSchema(pluginV6, plugin2, path);
    plugins.set(id, plugin2);
  }
  for (const path of Object.keys(files).filter((name) => /^skills\/[^/]+\/config\.json$/.test(name))) validateSkillDocument(parseJson3(files[path], path), path, 2);
  validateV6References(flow2, nodes, plugins);
  const compatible = { ...files };
  compatible["manifest.json"] = JSON.stringify({ ...manifest, formatVersion: 5 });
  for (const [id, plugin2] of plugins) {
    const { kind: _kind, ...legacy2 } = plugin2;
    compatible[`plugins/${id}/agent-plugin.json`] = JSON.stringify(legacy2);
  }
  const archive = createZip(compatible);
  const normalized = await parseAiPackageV5(await archive.arrayBuffer(), fallbackName);
  const restoredPlugins = normalized.plugins.map((plugin2) => ({ ...plugin2, kind: String(plugins.get(plugin2.id)?.kind) }));
  return { ...normalized, formatVersion: 6, plugins: restoredPlugins };
}

// ../../lib/ai-package-v7-format.ts
function parseJson4(text2, path) {
  if (text2 === void 0) throw new AiPackageValidationError("MISSING_FILE", "parse", `.ai \u5305\u7F3A\u5C11 ${path}`);
  try {
    const value = JSON.parse(text2);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object");
    return value;
  } catch (error) {
    throw new AiPackageValidationError("INVALID_JSON", "parse", `${path} \u4E0D\u662F\u6709\u6548 JSON`, [{
      code: "INVALID_JSON",
      path,
      message: error instanceof Error ? error.message : "JSON parse failed"
    }]);
  }
}
function buildAiPackageV7Files(project, timestamp) {
  const files = buildAiPackageV6Files(project, timestamp);
  const manifest = parseJson4(files["manifest.json"], "manifest.json");
  files["manifest.json"] = JSON.stringify({ ...manifest, formatVersion: 7 }, null, 2);
  return files;
}
async function parseAiPackageV7(buffer, fallbackName = "agent-project") {
  const files = await readZip(buffer);
  const manifest = parseJson4(files["manifest.json"], "manifest.json");
  assertSchema(manifestV7, manifest, "manifest.json");
  const flow2 = parseJson4(files["flow/flow.json"], "flow/flow.json");
  assertSchema(flowV7, flow2, "flow/flow.json");
  for (const path of Object.keys(files).filter((name) => /^flow\/nodes\/[^/]+\.json$/.test(name))) {
    assertSchema(nodeV7, parseJson4(files[path], path), path);
  }
  for (const path of Object.keys(files).filter((name) => /^plugins\/[^/]+\/agent-plugin\.json$/.test(name))) {
    assertSchema(pluginV7, parseJson4(files[path], path), path);
  }
  const compatible = { ...files };
  compatible["manifest.json"] = JSON.stringify({ ...manifest, formatVersion: 6 });
  const flowConfig = flow2.config && typeof flow2.config === "object" && !Array.isArray(flow2.config) ? { ...flow2.config } : {};
  const interaction = flowConfig.interaction && typeof flowConfig.interaction === "object" && !Array.isArray(flowConfig.interaction) ? { ...flowConfig.interaction } : void 0;
  if (interaction) {
    delete interaction.streaming;
    if (Object.keys(interaction).length) flowConfig.interaction = interaction;
    else delete flowConfig.interaction;
  }
  compatible["flow/flow.json"] = JSON.stringify({ ...flow2, config: flowConfig });
  const normalized = await parseAiPackageV6(await createZip(compatible).arrayBuffer(), fallbackName);
  const streaming = flow2.config?.interaction?.streaming;
  const restoredInteraction = streaming ? { ...normalized.interaction ?? {}, streaming: structuredClone(streaming) } : normalized.interaction;
  return { ...normalized, formatVersion: 7, ...restoredInteraction ? { interaction: restoredInteraction } : {} };
}

// ../../lib/ai-package-beta-one-format.ts
var FLOW_HOOK_OPERATIONS2 = /* @__PURE__ */ new Set(["beforeNode", "afterNode", "onNodeError"]);
function parseJson5(text2, path) {
  if (text2 === void 0) throw new AiPackageValidationError("MISSING_FILE", "parse", `.ai \u5305\u7F3A\u5C11 ${path}`);
  try {
    const value = JSON.parse(text2);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object");
    return value;
  } catch (error) {
    throw new AiPackageValidationError("INVALID_JSON", "parse", `${path} \u4E0D\u662F\u6709\u6548 JSON`, [{
      code: "INVALID_JSON",
      path,
      message: error instanceof Error ? error.message : "JSON parse failed"
    }]);
  }
}
function validateFlowHooks(flow2, plugins) {
  const issues = [];
  const config = flow2.config && typeof flow2.config === "object" && !Array.isArray(flow2.config) ? flow2.config : {};
  const hookIds = Array.isArray(config.hookIds) ? config.hookIds.map(String) : [];
  if (new Set(hookIds).size !== hookIds.length) issues.push({ code: "DUPLICATE_FLOW_HOOK", path: "flow/flow.json", jsonPointer: "/config/hookIds", message: "Flow Hook \u5F15\u7528\u91CD\u590D" });
  for (const hookId of hookIds) {
    const plugin2 = plugins.get(hookId);
    if (!plugin2) issues.push({ code: "MISSING_FLOW_HOOK", path: "flow/flow.json", jsonPointer: "/config/hookIds", message: `Flow Hook bundle ${hookId} \u4E0D\u5B58\u5728` });
    else if (plugin2.kind !== "flow-hook") issues.push({ code: "FLOW_HOOK_KIND_INVALID", path: `plugins/${hookId}/agent-plugin.json`, message: `${hookId} \u4E0D\u662F flow-hook bundle` });
  }
  for (const [id, plugin2] of plugins) {
    if (plugin2.kind !== "flow-hook") continue;
    if (!hookIds.includes(id)) issues.push({ code: "ORPHAN_FLOW_HOOK", path: `plugins/${id}/agent-plugin.json`, message: `Flow Hook ${id} \u672A\u88AB\u5E94\u7528\u5F15\u7528` });
    const tools = Array.isArray(plugin2.tools) ? plugin2.tools : [];
    const names = tools.map((tool) => String(tool.name ?? ""));
    if (new Set(names).size !== names.length) issues.push({ code: "DUPLICATE_BUNDLE_OPERATION", path: `plugins/${id}/agent-plugin.json`, message: `Flow Hook ${id} \u5B58\u5728\u91CD\u590D operation` });
    for (const tool of tools) {
      const name = String(tool.name ?? "");
      if (!FLOW_HOOK_OPERATIONS2.has(name)) issues.push({ code: "FLOW_HOOK_OPERATION_INVALID", path: `plugins/${id}/agent-plugin.json`, message: `\u672A\u77E5 Flow Hook operation\uFF1A${name}` });
      try {
        assertJsonSchemaDefinition(tool.inputSchema, `plugins/${id}/${name}/inputSchema`);
        assertJsonSchemaDefinition(tool.outputSchema, `plugins/${id}/${name}/outputSchema`);
      } catch (error) {
        issues.push({ code: "FLOW_HOOK_SCHEMA_INVALID", path: `plugins/${id}/agent-plugin.json`, message: error instanceof Error ? error.message : "Flow Hook Schema \u65E0\u6548" });
      }
    }
  }
  if (issues.length) throw new AiPackageValidationError("REFERENCE_INVALID", "validate", `${issues[0].path}\uFF1A${issues[0].message}`, issues);
  return hookIds;
}
function buildAiPackageBeta1Files(project, timestamp) {
  const files = buildAiPackageV7Files(project, timestamp);
  const manifest = parseJson5(files["manifest.json"], "manifest.json");
  files["manifest.json"] = JSON.stringify({ ...manifest, formatVersion: 8 }, null, 2);
  const flow2 = parseJson5(files["flow/flow.json"], "flow/flow.json");
  const config = flow2.config && typeof flow2.config === "object" && !Array.isArray(flow2.config) ? flow2.config : {};
  files["flow/flow.json"] = JSON.stringify({ ...flow2, config: { ...config, ...project.flowHookIds?.length ? { hookIds: project.flowHookIds } : {} } }, null, 2);
  return files;
}
function createAiPackageBeta1(project, timestamp) {
  return createZip(buildAiPackageBeta1Files(project, timestamp));
}
async function parseAiPackageBeta1(buffer, fallbackName = "agent-project") {
  const files = await readZip(buffer);
  const manifest = parseJson5(files["manifest.json"], "manifest.json");
  assertSchema(manifestBeta1, manifest, "manifest.json");
  const flow2 = parseJson5(files["flow/flow.json"], "flow/flow.json");
  assertSchema(flowBeta1, flow2, "flow/flow.json");
  for (const path of Object.keys(files).filter((name) => /^flow\/nodes\/[^/]+\.json$/.test(name))) assertSchema(nodeBeta1, parseJson5(files[path], path), path);
  const plugins = /* @__PURE__ */ new Map();
  for (const path of Object.keys(files).filter((name) => /^plugins\/[^/]+\/agent-plugin\.json$/.test(name))) {
    const plugin2 = parseJson5(files[path], path);
    assertSchema(pluginBeta1, plugin2, path);
    plugins.set(path.split("/")[1], plugin2);
  }
  const flowHookIds = validateFlowHooks(flow2, plugins);
  const compatible = { ...files };
  compatible["manifest.json"] = JSON.stringify({ ...manifest, formatVersion: 7 });
  const config = flow2.config && typeof flow2.config === "object" && !Array.isArray(flow2.config) ? { ...flow2.config } : {};
  delete config.hookIds;
  compatible["flow/flow.json"] = JSON.stringify({ ...flow2, config });
  for (const [id, plugin2] of plugins) if (plugin2.kind === "flow-hook") {
    compatible[`plugins/${id}/agent-plugin.json`] = JSON.stringify({ ...plugin2, kind: "plugin" });
  }
  const normalized = await parseAiPackageV7(await createZip(compatible).arrayBuffer(), fallbackName);
  const restoredPlugins = normalized.plugins.map((plugin2) => ({
    ...plugin2,
    kind: String(plugins.get(plugin2.id)?.kind ?? plugin2.kind)
  }));
  return { ...normalized, formatVersion: 8, plugins: restoredPlugins, ...flowHookIds.length ? { flowHookIds } : {} };
}

// src/build.ts
var SDK_VERSION = "0.8.0";
var moduleUrl = new URL(import.meta.url);
var pluginRuntimePath = fileURLToPath(new URL(moduleUrl.pathname.endsWith(".ts") ? "./plugin.ts" : "./plugin.js", moduleUrl));
var codeRuntimePath = fileURLToPath(new URL(moduleUrl.pathname.endsWith(".ts") ? "./code.ts" : "./code.js", moduleUrl));
var hookRuntimePath = fileURLToPath(new URL(moduleUrl.pathname.endsWith(".ts") ? "./hook.ts" : "./hook.js", moduleUrl));
var flowHookRuntimePath = fileURLToPath(new URL(moduleUrl.pathname.endsWith(".ts") ? "./flow-hook.ts" : "./flow-hook.js", moduleUrl));
var RUNTIME_BUNDLE_ENTRY = "dist/index.js";
function wrap(error, code, message) {
  if (error instanceof AiSdkError) throw error;
  const value = error;
  const issues = Array.isArray(value?.issues) ? value.issues.map((issue) => ({ code: String(issue.code ?? code), message: String(issue.message ?? message) })) : [];
  throw new AiSdkError(String(value?.code ?? code), error instanceof Error ? error.message : message, issues, { cause: error });
}
function entryPath(definition, subject) {
  let url;
  try {
    url = new URL(definition.entry);
  } catch {
    throw new AiSdkError(`INVALID_${subject.toUpperCase()}_ENTRY`, `${subject} \u201C${definition.id}\u201D\u7684 entry \u5FC5\u987B\u662F import.meta.url \u751F\u6210\u7684 file URL`);
  }
  if (url.protocol !== "file:") throw new AiSdkError(`INVALID_${subject.toUpperCase()}_ENTRY`, `${subject} \u201C${definition.id}\u201D\u53EA\u652F\u6301 file: entry`);
  return fileURLToPath(url);
}
function runtimeBundlePackageJson(definition) {
  return JSON.stringify({
    name: definition.id.toLowerCase().replace(/_/g, "-"),
    version: definition.version,
    private: true,
    type: "module",
    dependencies: { "@agcomm/ai-sdk": `^${SDK_VERSION}` },
    scripts: { build: `esbuild src/index.ts --bundle --platform=browser --format=esm --target=es2022 --outfile=${RUNTIME_BUNDLE_ENTRY}` }
  }, null, 2);
}
var PLUGIN_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    noEmit: true,
    lib: ["ES2022", "WebWorker"]
  },
  include: ["src/**/*.ts"]
}, null, 2);
async function bundleEntry(entry, options) {
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: dirname(entry),
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
    plugins: [{
      name: options.pluginName,
      setup(api) {
        api.onResolve({ filter: options.importPattern }, () => ({ path: options.runtimePath }));
      }
    }]
  });
  const exports = Object.values(result.metafile.outputs).flatMap((output2) => output2.exports);
  if (!exports.includes("default")) throw new Error(options.missingDefaultMessage);
  const output = result.outputFiles.find((file) => file.path.endsWith(".js")) ?? result.outputFiles[0];
  if (!output) throw new Error("esbuild did not produce a JavaScript bundle");
  return output.text;
}
async function compilePlugin(definition) {
  const entry = entryPath(definition, "Plugin");
  let sourceCode;
  try {
    sourceCode = await readFile(entry, "utf8");
  } catch (error) {
    throw new AiSdkError("PLUGIN_ENTRY_UNREADABLE", `\u65E0\u6CD5\u8BFB\u53D6 Plugin \u201C${definition.id}\u201D\u5165\u53E3\uFF1A${entry}`, [], { cause: error });
  }
  if (!definition.tools || !Object.keys(definition.tools).length) throw new AiSdkError("INVALID_PLUGIN", `Plugin \u201C${definition.id}\u201D\u81F3\u5C11\u9700\u8981\u4E00\u4E2A Tool`);
  let bundleCode;
  try {
    bundleCode = await bundleEntry(entry, {
      importPattern: /^@agcomm\/(?:ai-sdk\/plugin|plugin-sdk)$/,
      runtimePath: pluginRuntimePath,
      pluginName: "agcomm-ai-sdk-plugin-runtime",
      missingDefaultMessage: "plugin entry must default-export definePlugin(...)"
    });
  } catch (error) {
    throw new AiSdkError("PLUGIN_BUILD_FAILED", `Plugin \u201C${definition.id}\u201D\u6784\u5EFA\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`, [], { cause: error });
  }
  const permissions = [...new Set(definition.permissions ?? [])];
  const tools = Object.entries(definition.tools).map(([name, tool]) => ({
    name,
    description: tool.description?.trim() ?? "",
    ...tool.inputSchema ? { inputSchema: tool.inputSchema } : {},
    ...tool.outputSchema ? { outputSchema: tool.outputSchema } : {},
    permissions: [...new Set(tool.permissions ?? [])]
  }));
  for (const tool of tools) if (!tool.description) throw new AiSdkError("INVALID_PLUGIN_TOOL", `Plugin \u201C${definition.id}\u201D\u7684 Tool \u201C${tool.name}\u201D\u7F3A\u5C11 description`);
  return { ...await finalizePlugin({
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "",
    version: definition.version,
    sdkVersion: "1",
    language: "typescript",
    entry: RUNTIME_BUNDLE_ENTRY,
    runtime: "runtime",
    source: "custom",
    ...definition.author ? { author: definition.author } : {},
    ...definition.license ? { license: definition.license } : {},
    ...definition.homepage ? { homepage: definition.homepage } : {},
    permissions,
    tools,
    ...definition.limits ? { limits: definition.limits } : {},
    packageJson: runtimeBundlePackageJson(definition),
    tsconfigJson: PLUGIN_TSCONFIG,
    sourceCode,
    bundleCode,
    readme: definition.readme ?? `# ${definition.name}

Portable AgComm plugin built with @agcomm/ai-sdk.
`
  }), kind: "plugin" };
}
async function compileCode(definition) {
  return compileRuntimeBundle(definition, {
    kind: "code",
    subject: "Code",
    entrySubject: "Code",
    runtimePath: codeRuntimePath,
    importPattern: /^@agcomm\/ai-sdk(?:\/code)?$/,
    pluginName: "agcomm-ai-sdk-code-runtime",
    missingDefaultMessage: "code entry must default-export defineCode(...)",
    tools: [{
      name: "run",
      description: definition.description,
      inputSchema: structuredClone(definition.inputSchema),
      outputSchema: structuredClone(definition.outputSchema),
      permissions: [...definition.permissions]
    }],
    readme: "Deterministic Code node"
  });
}
async function compileHook(definition) {
  return compileRuntimeBundle(definition, {
    kind: "workspace-hook",
    subject: "Workspace Hook",
    entrySubject: "Hook",
    runtimePath: hookRuntimePath,
    importPattern: /^@agcomm\/ai-sdk(?:\/hook)?$/,
    pluginName: "agcomm-ai-sdk-hook-runtime",
    missingDefaultMessage: "hook entry must default-export defineWorkspaceHook(...)",
    tools: hookTools(definition, "Workspace Hook"),
    readme: "Portable Workspace Hook"
  });
}
async function compileFlowHook(definition) {
  return compileRuntimeBundle(definition, {
    kind: "flow-hook",
    subject: "Flow Hook",
    entrySubject: "Hook",
    runtimePath: flowHookRuntimePath,
    importPattern: /^@agcomm\/ai-sdk(?:\/flow-hook)?$/,
    pluginName: "agcomm-ai-sdk-flow-hook-runtime",
    missingDefaultMessage: "flow hook entry must default-export defineFlowHook(...)",
    tools: hookTools(definition, "Flow Hook"),
    readme: "Portable Flow Hook"
  });
}
function hookTools(definition, subject) {
  return Object.entries(definition.tools).map(([name, tool]) => ({
    name,
    description: tool.description ?? `${subject} ${name}`,
    inputSchema: structuredClone(tool.inputSchema ?? { type: "object" }),
    outputSchema: structuredClone(tool.outputSchema ?? { type: ["object", "null"] }),
    permissions: [...new Set(tool.permissions ?? definition.permissions)]
  }));
}
async function compileRuntimeBundle(definition, options) {
  const entry = entryPath(definition, options.entrySubject);
  let sourceCode;
  try {
    sourceCode = await readFile(entry, "utf8");
  } catch (error) {
    const prefix = options.kind === "flow-hook" ? "FLOW_HOOK" : options.kind === "workspace-hook" ? "HOOK" : "CODE";
    throw new AiSdkError(`${prefix}_ENTRY_UNREADABLE`, `\u65E0\u6CD5\u8BFB\u53D6 ${options.subject} \u201C${definition.id}\u201D\u5165\u53E3\uFF1A${entry}`, [], { cause: error });
  }
  let bundleCode;
  try {
    bundleCode = await bundleEntry(entry, options);
  } catch (error) {
    const prefix = options.kind === "flow-hook" ? "FLOW_HOOK" : options.kind === "workspace-hook" ? "HOOK" : "CODE";
    throw new AiSdkError(`${prefix}_BUILD_FAILED`, `${options.subject} \u201C${definition.id}\u201D\u6784\u5EFA\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`, [], { cause: error });
  }
  return { ...await finalizePlugin({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: definition.version,
    sdkVersion: "1",
    language: "typescript",
    entry: RUNTIME_BUNDLE_ENTRY,
    runtime: "runtime",
    source: "custom",
    permissions: [...definition.permissions],
    tools: options.tools,
    ...definition.limits ? { limits: { ...definition.limits } } : {},
    packageJson: runtimeBundlePackageJson(definition),
    tsconfigJson: PLUGIN_TSCONFIG,
    sourceCode,
    bundleCode,
    readme: `# ${definition.name}

${options.readme} built with @agcomm/ai-sdk.
`
  }), kind: options.kind };
}
async function compileApp(app) {
  try {
    const prepared = preparedApp(app);
    const bundleDefinitions = [...prepared.plugins, ...prepared.codes, ...prepared.hooks, ...prepared.flowHooks];
    const bundleIds = /* @__PURE__ */ new Set();
    for (const definition of bundleDefinitions) {
      if (bundleIds.has(definition.id)) throw new AiSdkError("BUNDLE_ID_CONFLICT", `Plugin\u3001Code \u6216 Hook ID \u201C${definition.id}\u201D\u51B2\u7A81`);
      bundleIds.add(definition.id);
    }
    const nodeCollision = prepared.project.nodes.find((node2) => bundleIds.has(node2.id));
    if (nodeCollision) throw new AiSdkError("NODE_BUNDLE_ID_CONFLICT", `\u8282\u70B9 ID \u201C${nodeCollision.id}\u201D\u4E0E bundle ID \u51B2\u7A81`);
    const [plugins, codes, hooks, flowHooks] = await Promise.all([
      Promise.all(prepared.plugins.map(compilePlugin)),
      Promise.all(prepared.codes.map(compileCode)),
      Promise.all(prepared.hooks.map(compileHook)),
      Promise.all(prepared.flowHooks.map(compileFlowHook))
    ]);
    const project = { ...structuredClone(prepared.project), formatVersion: 8, plugins: [...plugins, ...codes, ...hooks, ...flowHooks] };
    const validation = validateEditorFlow(project);
    if (!validation.valid) {
      const issues = validation.issues.filter((issue) => issue.severity === "error").map((issue) => ({
        code: issue.code,
        message: issue.message,
        ...issue.nodeId ? { nodeId: issue.nodeId } : {}
      }));
      throw new AiSdkError("APP_INVALID", issues[0]?.message ?? "App \u6821\u9A8C\u5931\u8D25", issues);
    }
    return Object.freeze({ formatVersion: 8, project });
  } catch (error) {
    wrap(error, "COMPILE_FAILED", "App \u7F16\u8BD1\u5931\u8D25");
  }
}
async function packageApp(app) {
  const compiled = await compileApp(app);
  try {
    const { formatVersion: _formatVersion, ...project } = compiled.project;
    const archive = createAiPackageBeta1(project);
    const buffer = await archive.arrayBuffer();
    await parseAiPackageBeta1(buffer, compiled.project.name);
    return { compiled, bytes: new Uint8Array(buffer) };
  } catch (error) {
    wrap(error, "PACKAGE_BUILD_FAILED", ".ai \u6784\u5EFA\u6216 round-trip \u6821\u9A8C\u5931\u8D25");
  }
}
async function buildAi(app) {
  return (await packageApp(app)).bytes;
}
function outputPath(path) {
  if (path instanceof URL && path.protocol !== "file:") throw new AiSdkError("INVALID_OUTPUT_PATH", "\u8F93\u51FA URL \u5FC5\u987B\u4F7F\u7528 file: \u534F\u8BAE");
  const value = path instanceof URL ? fileURLToPath(path) : resolve(path);
  if (!/\.ai$/i.test(value)) throw new AiSdkError("INVALID_OUTPUT_PATH", "\u8F93\u51FA\u6587\u4EF6\u5FC5\u987B\u4F7F\u7528 .ai \u6269\u5C55\u540D");
  return value;
}
async function writeAi(app, path) {
  const target = outputPath(path);
  const built = await packageApp(app);
  await mkdir(dirname(target), { recursive: true });
  const temporary = resolve(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, built.bytes);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new AiSdkError("WRITE_FAILED", `\u65E0\u6CD5\u5199\u5165 ${target}`, [], { cause: error });
  }
  return { path: target, byteLength: built.bytes.byteLength, compiled: built.compiled };
}
function fileUrl(path) {
  return pathToFileURL(resolve(path));
}

// src/runtime.ts
import { mkdtemp, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function loadRuntime() {
  try {
    return await import("@agcomm/ai-runtime");
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return import(new URL("../../ai-runtime/dist/index.js", import.meta.url).href);
  }
}
async function loadGateway() {
  try {
    return await import("@agcomm/gateway");
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return import(new URL("../../gateway/dist/index.js", import.meta.url).href);
  }
}
async function createAppRunner(app, runtimeOptions = {}) {
  const bytes = await buildAi(app);
  const { createRuntime } = await loadRuntime();
  const runtime = createRuntime(runtimeOptions);
  const opened = await runtime.openAiApp(bytes);
  let disposed = false;
  const assertOpen = () => {
    if (disposed) throw new Error("AppRunner has been disposed");
  };
  return {
    packageHash: opened.packageHash,
    info: opened.info,
    async preflight() {
      assertOpen();
      return opened.preflight();
    },
    async run(options = {}) {
      assertOpen();
      return opened.run(options);
    },
    stream(options = {}) {
      assertOpen();
      return opened.stream(options);
    },
    async listSessions() {
      assertOpen();
      return opened.listSessions();
    },
    async createSession(options) {
      assertOpen();
      return opened.createSession(options);
    },
    async openSession(id) {
      assertOpen();
      return opened.openSession(id);
    },
    async deleteSession(id) {
      assertOpen();
      return opened.deleteSession(id);
    },
    async listKnowledge(scope) {
      assertOpen();
      return opened.listKnowledge(scope);
    },
    async importKnowledge(paths, options) {
      assertOpen();
      return opened.importKnowledge(paths, options);
    },
    async removeKnowledge(ids, scope) {
      assertOpen();
      return opened.removeKnowledge(ids, scope);
    },
    async reindexKnowledge(ids, options) {
      assertOpen();
      return opened.reindexKnowledge(ids, options);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await opened.dispose();
      await runtime.dispose();
    }
  };
}
async function runApp(app, options = {}) {
  const runner = await createAppRunner(app, options.runtime);
  try {
    return await runner.run(options.run);
  } finally {
    await runner.dispose();
  }
}
async function streamApp(app, options = {}) {
  const runner = await createAppRunner(app, options.runtime);
  try {
    const stream = runner.stream(options.run);
    void stream.result.then(() => runner.dispose(), () => runner.dispose());
    return stream;
  } catch (error) {
    await runner.dispose();
    throw error;
  }
}
async function installBackgroundApp(app, options = {}) {
  const bytes = await buildAi(app);
  const gatewayModule = await loadGateway();
  const gateway = options.gateway ?? await gatewayModule.connectRuntimeGateway({ root: options.gatewayRoot });
  const directory = await mkdtemp(join(tmpdir(), "agcomm-sdk-gateway-"));
  const path = join(directory, "app.ai");
  try {
    await writeFile2(path, bytes, { mode: 384 });
    return await gateway.install(path, options.install);
  } finally {
    await rm2(directory, { recursive: true, force: true });
  }
}
export {
  AiSdkError,
  buildAi,
  compileApp,
  createAppRunner,
  defineApp,
  defineCode,
  defineFlowHook,
  defineSkill,
  defineWorkspaceHook,
  fileUrl,
  installBackgroundApp,
  runApp,
  streamApp,
  template,
  variable,
  writeAi
};
