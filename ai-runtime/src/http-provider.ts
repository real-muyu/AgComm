import { Buffer } from "node:buffer";
import { AiRuntimeError } from "./errors.ts";
import { createHttpRequestExecutor } from "./runtime/HttpRequestExecutor.ts";
import { readSseFrames } from "./runtime/SseFrameReader.ts";
import { ToolCallDeltaAccumulator } from "./runtime/ToolCallDeltaAccumulator.ts";
import type { ModelEvent, ModelProvider, ModelReply } from "./runtime/contracts/ModelPort.ts";
import type { HttpModelProviderConfig, HttpProviderAuth, JsonResponseMapping, RequestTransformContext, RequestTransformResult, SseResponseMapping, ToolCallMapping } from "./provider-contracts.ts";
export type { HttpModelProviderConfig, HttpProviderAuth, JsonResponseMapping, RequestTransformContext, RequestTransformResult, SseResponseMapping, ToolCallMapping } from "./provider-contracts.ts";

const MAX_TRANSFORM_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_SSE_EVENT_BYTES = 256 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ALLOWED_METHODS = new Set(["POST", "PUT", "PATCH"]);
const FORBIDDEN_HEADERS = new Set([
  "authorization", "proxy-authorization", "cookie", "set-cookie", "host", "content-length",
  "transfer-encoding", "connection", "keep-alive", "te", "trailer", "upgrade",
]);
const MISSING = Symbol("missing-json-pointer");

function fail(code: string, message: string, cause?: unknown): never {
  throw new AiRuntimeError(code, message, cause === undefined ? undefined : { cause });
}

function assertPointer(pointer: unknown, subject: string) {
  if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/"))) fail("HTTP_MAPPING_INVALID", `${subject} must be an RFC 6901 JSON Pointer`);
  for (let index = 0; index < pointer.length; index++) {
    if (pointer[index] === "~" && !["0", "1"].includes(pointer[index + 1] ?? "")) fail("HTTP_MAPPING_INVALID", `${subject} contains an invalid JSON Pointer escape`);
  }
  return pointer;
}

function jsonPointer(value: unknown, pointer: string): unknown | typeof MISSING {
  if (pointer === "") return value;
  let current = value;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^0$|^[1-9]\d*$/.test(token) || Number(token) >= current.length) return MISSING;
      current = current[Number(token)];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.hasOwn(current, token)) return MISSING;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function scalarText(value: unknown) {
  if (value === MISSING || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") return String((item as Record<string, unknown>).text);
    return "";
  }).join("");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function argumentsValue(value: unknown) {
  if (value === MISSING || value == null || value === "") return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch { fail("HTTP_RESPONSE_INVALID", "Provider returned invalid tool arguments JSON"); }
  }
  if (typeof value === "object") return value;
  fail("HTTP_RESPONSE_INVALID", "Provider returned invalid tool arguments");
}

function validateToolMapping(mapping: ToolCallMapping | undefined, subject: string, requireIndex = false) {
  if (!mapping) fail("HTTP_MAPPING_INVALID", `${subject} is required when tool calls are configured`);
  if (mapping.idPointer !== undefined) assertPointer(mapping.idPointer, `${subject}.idPointer`);
  assertPointer(mapping.namePointer, `${subject}.namePointer`);
  assertPointer(mapping.argumentsPointer, `${subject}.argumentsPointer`);
  if (requireIndex) assertPointer((mapping as ToolCallMapping & { indexPointer?: string }).indexPointer, `${subject}.indexPointer`);
}

function validateResponseMapping(mapping: HttpModelProviderConfig["response"]) {
  if (!mapping || typeof mapping !== "object") fail("HTTP_CONNECTION_INVALID", "HTTP provider response mapping is required");
  if (mapping.mode === "json") {
    assertPointer(mapping.contentPointer, "response.contentPointer");
    if (mapping.toolCallsPointer !== undefined) {
      assertPointer(mapping.toolCallsPointer, "response.toolCallsPointer");
      validateToolMapping(mapping.toolCall, "response.toolCall");
    }
    return;
  }
  if (mapping.mode === "sse") {
    assertPointer(mapping.contentDeltaPointer, "response.contentDeltaPointer");
    if (mapping.toolCallDeltasPointer !== undefined) {
      assertPointer(mapping.toolCallDeltasPointer, "response.toolCallDeltasPointer");
      validateToolMapping(mapping.toolCall, "response.toolCall", true);
    }
    return;
  }
  fail("HTTP_CONNECTION_INVALID", "HTTP provider response mode must be json or sse");
}

function validateHeaderName(name: string, subject: string, allowAuth = false) {
  try { new Headers({ [name]: "value" }); }
  catch { fail("HTTP_CONNECTION_INVALID", `${subject} contains an invalid header name`); }
  const normalized = name.toLowerCase();
  if (FORBIDDEN_HEADERS.has(normalized) && !(allowAuth && normalized === "authorization")) fail("HTTP_CONNECTION_INVALID", `${subject} cannot set protected header ${name}`);
  if (!allowAuth && /(?:api[-_]?key|token|secret)/i.test(normalized)) fail("HTTP_CONNECTION_INVALID", `${subject} must use auth environment references for sensitive headers`);
  return normalized;
}

function resolveSecret(name: unknown, environment: Readonly<Record<string, string | undefined>>, subject: string) {
  if (typeof name !== "string" || !ENV_NAME.test(name)) fail("HTTP_CONNECTION_INVALID", `${subject} must be a valid environment variable name`);
  const value = environment[name];
  if (!value) fail("HTTP_AUTH_MISSING", `Required authentication environment variable is missing: ${name}`);
  return value;
}

function authentication(auth: HttpProviderAuth | undefined, environment: Readonly<Record<string, string | undefined>>) {
  if (!auth || auth.type === "none") return { headers: {} as Record<string, string>, secrets: [] as string[] };
  if (auth.type === "bearer") {
    const token = resolveSecret(auth.tokenEnv, environment, "auth.tokenEnv");
    return { headers: { authorization: `Bearer ${token}` }, secrets: [token] };
  }
  if (auth.type === "apiKey") {
    const normalized = validateHeaderName(auth.header, "auth.header", true);
    if (["host", "content-length", "cookie", "set-cookie", "proxy-authorization"].includes(normalized)) fail("HTTP_CONNECTION_INVALID", `auth.header cannot use protected header ${auth.header}`);
    const value = resolveSecret(auth.valueEnv, environment, "auth.valueEnv");
    return { headers: { [auth.header]: value }, secrets: [value] };
  }
  if (auth.type === "basic") {
    const username = resolveSecret(auth.usernameEnv, environment, "auth.usernameEnv");
    const password = resolveSecret(auth.passwordEnv, environment, "auth.passwordEnv");
    return { headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}` }, secrets: [username, password] };
  }
  fail("HTTP_CONNECTION_INVALID", "Unsupported HTTP provider authentication type");
}

function compileTransformer(source: HttpModelProviderConfig["requestTransformer"]) {
  if (typeof source === "function") return source;
  if (typeof source !== "string" || !source.trim()) fail("HTTP_CONNECTION_INVALID", "requestTransformer must be a JavaScript function");
  try {
    const transformer = Function(`"use strict"; return (${source}\n);`)() as unknown;
    if (typeof transformer !== "function") fail("HTTP_CONNECTION_INVALID", "requestTransformer must evaluate to a function");
    return transformer as (context: RequestTransformContext) => RequestTransformResult | Promise<RequestTransformResult>;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw error;
    fail("HTTP_CONNECTION_INVALID", "requestTransformer could not be compiled", error);
  }
}

function messageRole(message: Record<string, unknown>) {
  if (typeof message.role === "string") return message.role;
  const type = typeof message._getType === "function" ? String((message._getType as () => unknown)()) : "";
  return type === "human" ? "user" : type === "ai" ? "assistant" : type || "user";
}

function normalizedMessages(messages: unknown[]) {
  return messages.map((raw) => {
    const message = raw && typeof raw === "object" ? raw as Record<string, unknown> : { content: raw };
    const additional = message.additional_kwargs && typeof message.additional_kwargs === "object" ? message.additional_kwargs as Record<string, unknown> : {};
    const output: Record<string, unknown> = { role: messageRole(message), content: message.content ?? "" };
    const toolCalls = message.tool_calls ?? additional.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length) output.tool_calls = structuredClone(toolCalls);
    const toolCallId = message.tool_call_id ?? message.toolCallId;
    if (toolCallId) output.tool_call_id = String(toolCallId);
    if (message.name) output.name = String(message.name);
    return output;
  });
}

function assertJsonCompatible(value: unknown, path = "$", ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("HTTP_TRANSFORM_INVALID", `requestTransformer result contains a non-finite number at ${path}`);
    return;
  }
  if (typeof value !== "object") fail("HTTP_TRANSFORM_INVALID", `requestTransformer result contains a non-JSON value at ${path}`);
  if (ancestors.has(value)) fail("HTTP_TRANSFORM_INVALID", `requestTransformer result contains a circular reference at ${path}`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    fail("HTTP_TRANSFORM_INVALID", `requestTransformer result contains a non-plain object at ${path}`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail("HTTP_TRANSFORM_INVALID", `requestTransformer result contains a symbol property at ${path}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) fail("HTTP_TRANSFORM_INVALID", `requestTransformer result contains a sparse array at ${path}`);
        assertJsonCompatible(value[index], `${path}/${index}`, ancestors);
      }
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      assertJsonCompatible(item, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function validateTransformResult(value: unknown): RequestTransformResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("HTTP_TRANSFORM_INVALID", "requestTransformer must return an object");
  const result = value as Record<string, unknown>;
  if (!Object.hasOwn(result, "body")) fail("HTTP_TRANSFORM_INVALID", "requestTransformer result must contain body");
  assertJsonCompatible(value);
  let encoded: string;
  try { encoded = JSON.stringify(value); }
  catch (error) { fail("HTTP_TRANSFORM_INVALID", "requestTransformer result must be JSON-compatible", error); }
  if (encoded === undefined || Buffer.byteLength(encoded) > MAX_TRANSFORM_BYTES) fail("HTTP_TRANSFORM_INVALID", "requestTransformer result exceeds 1 MiB");
  if (result.query !== undefined && (!result.query || typeof result.query !== "object" || Array.isArray(result.query))) fail("HTTP_TRANSFORM_INVALID", "requestTransformer query must be an object");
  if (result.headers !== undefined && (!result.headers || typeof result.headers !== "object" || Array.isArray(result.headers))) fail("HTTP_TRANSFORM_INVALID", "requestTransformer headers must be an object");
  return result as RequestTransformResult;
}

function applyQuery(url: URL, query: RequestTransformResult["query"]) {
  for (const [key, raw] of Object.entries(query ?? {})) {
    if (!key || raw === undefined || (typeof raw === "object" && !Array.isArray(raw))) fail("HTTP_TRANSFORM_INVALID", "requestTransformer query values must be primitive values or primitive arrays");
    url.searchParams.delete(key);
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (!["string", "number", "boolean"].includes(typeof value)) {
        if (value === null) continue;
        fail("HTTP_TRANSFORM_INVALID", "requestTransformer query values must be primitive values");
      }
      url.searchParams.append(key, String(value));
    }
  }
}

function mergeHeaders(configured: Record<string, string> | undefined, added: RequestTransformResult["headers"], authHeaders: Record<string, string>, mode: "json" | "sse") {
  const headers = new Headers();
  for (const [name, value] of Object.entries(configured ?? {})) {
    validateHeaderName(name, "headers");
    if (typeof value !== "string") fail("HTTP_CONNECTION_INVALID", `Header ${name} must be a string`);
    headers.set(name, value);
  }
  for (const [name, value] of Object.entries(added ?? {})) {
    const normalized = validateHeaderName(name, "requestTransformer headers");
    if (headers.has(normalized) || Object.keys(authHeaders).some((item) => item.toLowerCase() === normalized)) fail("HTTP_TRANSFORM_INVALID", `requestTransformer cannot override header ${name}`);
    if (typeof value !== "string") fail("HTTP_TRANSFORM_INVALID", `requestTransformer header ${name} must be a string`);
    headers.set(name, value);
  }
  for (const [name, value] of Object.entries(authHeaders)) headers.set(name, value);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (!headers.has("accept")) headers.set("accept", mode === "sse" ? "text/event-stream" : "application/json");
  return headers;
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([reader.read(), aborted]); }
  finally { if (abort) signal.removeEventListener("abort", abort); }
}

async function readLimited(response: Response, signal: AbortSignal) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail("HTTP_RESPONSE_TOO_LARGE", "Provider response exceeds 4 MiB");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel("response too large");
        fail("HTTP_RESPONSE_TOO_LARGE", "Provider response exceeds 4 MiB");
      }
      chunks.push(value);
    }
  } finally {
    if (signal.aborted) await reader.cancel(signal.reason).catch(() => undefined);
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function mapCompleteToolCalls(payload: unknown, pointer: string | undefined, mapping: ToolCallMapping | undefined) {
  if (!pointer || !mapping) return [];
  const rawCalls = jsonPointer(payload, pointer);
  if (rawCalls === MISSING) return [];
  if (!Array.isArray(rawCalls)) fail("HTTP_RESPONSE_INVALID", "Mapped tool calls value must be an array");
  return rawCalls.map((raw, index) => {
    const name = scalarText(jsonPointer(raw, mapping.namePointer)).trim();
    if (!name) fail("HTTP_RESPONSE_INVALID", `Mapped tool call ${index} has no name`);
    const id = mapping.idPointer ? scalarText(jsonPointer(raw, mapping.idPointer)).trim() : "";
    return { id: id || `call_${index}`, name, args: argumentsValue(jsonPointer(raw, mapping.argumentsPointer)) };
  });
}

function normalizedReply(content: string, toolCalls: Array<{ id?: string; name: string; args?: unknown }>): ModelReply {
  const rawCalls = toolCalls.map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
  }));
  return { content, toolCalls, raw: { role: "assistant", content, ...(rawCalls.length ? { tool_calls: rawCalls } : {}) } };
}

async function parseJsonResponse(response: Response, mapping: JsonResponseMapping, signal: AbortSignal) {
  const bytes = await readLimited(response, signal);
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (error) { fail("HTTP_RESPONSE_INVALID", "Provider returned invalid JSON", error); }
  const contentValue = jsonPointer(payload, mapping.contentPointer);
  if (contentValue === MISSING && !mapping.toolCallsPointer) fail("HTTP_MAPPING_INVALID", `contentPointer did not match the provider response: ${mapping.contentPointer}`);
  return normalizedReply(scalarText(contentValue), mapCompleteToolCalls(payload, mapping.toolCallsPointer, mapping.toolCall));
}

async function parseSseResponse(response: Response, mapping: SseResponseMapping, signal: AbortSignal, onEvent?: (event: ModelEvent) => void) {
  const deltas = new ToolCallDeltaAccumulator(mapping, MISSING, jsonPointer, scalarText, onEvent);
  let content = "";
  for await (const data of readSseFrames(response, signal, { doneData: mapping.doneData ?? "[DONE]", maxResponseBytes: MAX_RESPONSE_BYTES, maxEventBytes: MAX_SSE_EVENT_BYTES })) {
    let payload: unknown;
    try { payload = JSON.parse(data); }
    catch (error) { fail("HTTP_SSE_INVALID", "Provider SSE data is not valid JSON", error); }
    const text = scalarText(jsonPointer(payload, mapping.contentDeltaPointer));
    if (text) { content += text; onEvent?.({ type: "token", text }); }
    deltas.append(payload);
  }
  return normalizedReply(content, deltas.complete(argumentsValue));
}

export function collectHttpProviderSecrets(config: HttpModelProviderConfig, environment = config.environment ?? process.env) {
  return authentication(config.auth, environment).secrets;
}

export function createHttpModelProvider(config: HttpModelProviderConfig): ModelProvider {
  if (!config || config.type !== "http") fail("HTTP_CONNECTION_INVALID", "HTTP provider type must be http");
  let endpoint: URL;
  try { endpoint = new URL(config.url); }
  catch (error) { fail("HTTP_CONNECTION_INVALID", "HTTP provider URL is invalid", error); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) fail("HTTP_CONNECTION_INVALID", "HTTP provider URL must be credential-free HTTPS");
  const method = String(config.method ?? "POST").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) fail("HTTP_CONNECTION_INVALID", "HTTP provider method must be POST, PUT, or PATCH");
  const model = String(config.model ?? "http-model").trim();
  if (!model) fail("HTTP_CONNECTION_INVALID", "HTTP provider model is required");
  const rawTemperature = Number(config.temperature ?? 0.3);
  const rawMaxTokens = Number(config.maxTokens ?? 2_048);
  const rawTimeoutMs = Number(config.timeoutMs ?? 60_000);
  if (!Number.isFinite(rawTemperature) || !Number.isFinite(rawMaxTokens) || !Number.isFinite(rawTimeoutMs)) fail("HTTP_CONNECTION_INVALID", "HTTP provider numeric limits must be finite numbers");
  const temperature = Math.max(0, Math.min(2, rawTemperature));
  const maxTokens = Math.max(64, Math.min(32_768, Math.floor(rawMaxTokens)));
  const timeoutMs = Math.max(100, Math.min(600_000, Math.floor(rawTimeoutMs)));
  if (config.headers !== undefined && (!config.headers || typeof config.headers !== "object" || Array.isArray(config.headers))) fail("HTTP_CONNECTION_INVALID", "HTTP provider headers must be an object");
  validateResponseMapping(config.response);
  const transformer = compileTransformer(config.requestTransformer);
  const environment = config.environment ?? process.env;
  const resolvedAuth = authentication(config.auth, environment);
  mergeHeaders(config.headers, undefined, resolvedAuth.headers, config.response.mode);
  const fetcher = config.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") fail("HTTP_CONNECTION_INVALID", "HTTP provider requires fetch");
  const supportsTools = config.response.mode === "json" ? Boolean(config.response.toolCallsPointer) : Boolean(config.response.toolCallDeltasPointer);

  return {
    model,
    supportsTools,
    call: createHttpRequestExecutor({
      endpoint, method, timeoutMs, model, temperature, maxTokens, supportsTools, fetcher,
      transform: transformer, normalizeMessages: normalizedMessages, validateTransform: validateTransformResult,
      headers: (result) => mergeHeaders(config.headers, result.headers, resolvedAuth.headers, config.response.mode),
      applyQuery,
      parseResponse: (response, signal, onEvent) => config.response.mode === "json"
        ? parseJsonResponse(response, config.response, signal)
        : parseSseResponse(response, config.response, signal, onEvent),
    }),
  };
}
