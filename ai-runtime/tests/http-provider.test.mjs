import assert from "node:assert/strict";
import test from "node:test";
import { AiRuntimeError, createHttpModelProvider } from "../dist/index.js";

const tool = { type: "function", function: { name: "lookup", description: "lookup", parameters: { type: "object" } } };

function call(provider, overrides = {}) {
  return provider.call({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    forceFinal: false,
    signal: new AbortController().signal,
    ...overrides,
  });
}

function jsonConfig(overrides = {}) {
  return {
    type: "http",
    url: "https://8.8.8.8/model",
    method: "POST",
    model: "vendor-model",
    auth: { type: "none" },
    requestTransformer: "async ({messages,tools,model}) => ({body:{messages,tools,model},query:{version:2},headers:{'x-request-id':'test'}})",
    response: {
      mode: "json",
      contentPointer: "/result/content",
      toolCallsPointer: "/result/calls",
      toolCall: { idPointer: "/id", namePointer: "/fn/name", argumentsPointer: "/fn/arguments" },
    },
    fetcher: async () => new Response(JSON.stringify({ result: { content: "ok", calls: [] } }), { status: 200, headers: { "content-type": "application/json" } }),
    ...overrides,
  };
}

test("maps JSON content and tool calls after running the trusted request transformer", async () => {
  let captured;
  const provider = createHttpModelProvider(jsonConfig({
    auth: { type: "bearer", tokenEnv: "VENDOR_TOKEN" },
    environment: { VENDOR_TOKEN: "secret-token" },
    headers: { "x-api-version": "2026-01" },
    requestTransformer: "({messages,tools,model,forceFinal}) => ({body:{messages,tools,model,forceFinal,pid:process.pid},query:{version:2},headers:{'x-request-id':'request-1'}})",
    fetcher: async (url, init) => {
      captured = { url: String(url), init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ result: { content: "mapped", calls: [{ id: "c1", fn: { name: "lookup", arguments: '{\"q\":\"weather\"}' } }] } }), { status: 200 });
    },
  }));
  const result = await call(provider, { tools: [tool] });
  assert.equal(result.content, "mapped");
  assert.deepEqual(result.toolCalls, [{ id: "c1", name: "lookup", args: { q: "weather" } }]);
  assert.match(captured.url, /version=2/);
  assert.equal(new Headers(captured.init.headers).get("authorization"), "Bearer secret-token");
  assert.equal(new Headers(captured.init.headers).get("x-api-version"), "2026-01");
  assert.equal(new Headers(captured.init.headers).get("x-request-id"), "request-1");
  assert.equal(captured.body.model, "vendor-model");
  assert.equal(captured.body.tools[0].function.name, "lookup");
  assert.equal(captured.body.pid, process.pid);
});

test("supports none, bearer, API key, and Basic authentication via environment references", async () => {
  const cases = [
    [{ type: "none" }, {}, null],
    [{ type: "bearer", tokenEnv: "TOKEN" }, { TOKEN: "bearer-value" }, ["authorization", "Bearer bearer-value"]],
    [{ type: "apiKey", header: "x-vendor-key", valueEnv: "KEY" }, { KEY: "api-key-value" }, ["x-vendor-key", "api-key-value"]],
    [{ type: "basic", usernameEnv: "USER", passwordEnv: "PASS" }, { USER: "alice", PASS: "pw" }, ["authorization", `Basic ${Buffer.from("alice:pw").toString("base64")}`]],
  ];
  for (const [auth, environment, expected] of cases) {
    let headers;
    const provider = createHttpModelProvider(jsonConfig({
      auth, environment,
      fetcher: async (_url, init) => { headers = new Headers(init.headers); return Response.json({ result: { content: "ok", calls: [] } }); },
    }));
    await call(provider);
    if (expected) assert.equal(headers.get(expected[0]), expected[1]);
    else assert.equal(headers.get("authorization"), null);
  }
});

test("aggregates SSE text and parallel tool-call deltas while emitting model events", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"delta":{"text":"Hel","calls":[{"index":0,"id":"call_","fn":{"name":"look","arguments":"{\\"q\\":"}}]}}\n\n',
    'data: {"delta":{"text":"lo","calls":[{"index":0,"id":"1","fn":{"name":"up","arguments":"\\"x\\"}"}}]}}\r\n\r\n',
    "data: [DONE]\n\n",
  ];
  const provider = createHttpModelProvider({
    type: "http", url: "https://8.8.8.8/stream", model: "sse-model", auth: { type: "none" },
    requestTransformer: "({messages,tools}) => ({body:{messages,tools}})",
    response: {
      mode: "sse", doneData: "[DONE]", contentDeltaPointer: "/delta/text", toolCallDeltasPointer: "/delta/calls",
      toolCall: { indexPointer: "/index", idPointer: "/id", namePointer: "/fn/name", argumentsPointer: "/fn/arguments" },
    },
    fetcher: async () => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  const events = [];
  const result = await call(provider, { tools: [tool], onEvent: (event) => events.push(event) });
  assert.equal(result.content, "Hello");
  assert.deepEqual(result.toolCalls, [{ id: "call_1", name: "lookup", args: { q: "x" } }]);
  assert.deepEqual(events.filter((event) => event.type === "token").map((event) => event.text), ["Hel", "lo"]);
  assert.equal(events.filter((event) => event.type === "tool-call-delta").length, 2);
});

test("rejects tools without response mapping instead of silently degrading", async () => {
  const config = jsonConfig({ response: { mode: "json", contentPointer: "/content" }, fetcher: async () => Response.json({ content: "unused" }) });
  const provider = createHttpModelProvider(config);
  await assert.rejects(() => call(provider, { tools: [tool] }), (error) => error instanceof AiRuntimeError && error.code === "PROVIDER_TOOLS_UNSUPPORTED");
});

test("validates authentication, protected headers, transformer output, and mappings before requests", async () => {
  assert.throws(
    () => createHttpModelProvider(jsonConfig({ auth: { type: "bearer", tokenEnv: "MISSING" }, environment: {} })),
    (error) => error instanceof AiRuntimeError && error.code === "HTTP_AUTH_MISSING",
  );
  assert.throws(
    () => createHttpModelProvider(jsonConfig({ headers: { authorization: "inline-secret" } })),
    (error) => error instanceof AiRuntimeError && error.code === "HTTP_CONNECTION_INVALID",
  );
  assert.throws(
    () => createHttpModelProvider(jsonConfig({ response: { mode: "json", contentPointer: "not-a-pointer" } })),
    (error) => error instanceof AiRuntimeError && error.code === "HTTP_MAPPING_INVALID",
  );
  assert.throws(
    () => createHttpModelProvider(jsonConfig({ timeoutMs: "not-a-number" })),
    (error) => error instanceof AiRuntimeError && error.code === "HTTP_CONNECTION_INVALID",
  );
  const oversized = createHttpModelProvider(jsonConfig({ requestTransformer: `() => ({body:{value:${JSON.stringify("x".repeat(1024 * 1024))}}})` }));
  await assert.rejects(() => call(oversized), (error) => error instanceof AiRuntimeError && error.code === "HTTP_TRANSFORM_INVALID");
  const lossyJson = createHttpModelProvider(jsonConfig({ requestTransformer: "() => ({body:{value:NaN,missing:undefined}})" }));
  await assert.rejects(() => call(lossyJson), (error) => error instanceof AiRuntimeError && error.code === "HTTP_TRANSFORM_INVALID");
  const overriding = createHttpModelProvider(jsonConfig({ requestTransformer: "() => ({body:{},headers:{authorization:'bad'}})" }));
  await assert.rejects(() => call(overriding), (error) => error instanceof AiRuntimeError && error.code === "HTTP_CONNECTION_INVALID");
});

test("enforces HTTPS, private-address, redirect, response-size, and malformed-response boundaries", async () => {
  assert.throws(() => createHttpModelProvider(jsonConfig({ url: "http://8.8.8.8/model" })), /HTTPS/);
  await assert.rejects(
    () => call(createHttpModelProvider(jsonConfig({ url: "https://127.0.0.1/model" }))),
    /public|公开|HTTPS/i,
  );
  await assert.rejects(
    () => call(createHttpModelProvider(jsonConfig({ fetcher: async () => new Response(null, { status: 302, headers: { location: "https://8.8.8.8/elsewhere" } }) }))),
    (error) => error instanceof AiRuntimeError && error.code === "HTTP_PROVIDER_REDIRECT",
  );
  await assert.rejects(
    () => call(createHttpModelProvider(jsonConfig({ fetcher: async () => new Response("{}", { headers: { "content-length": String(5 * 1024 * 1024) } }) }))),
    (error) => error instanceof AiRuntimeError && error.code === "HTTP_RESPONSE_TOO_LARGE",
  );
  await assert.rejects(
    () => call(createHttpModelProvider(jsonConfig({ fetcher: async () => new Response("not-json") }))),
    (error) => error instanceof AiRuntimeError && error.code === "HTTP_RESPONSE_INVALID",
  );
  const malformedSse = createHttpModelProvider({
    ...jsonConfig(),
    response: { mode: "sse", contentDeltaPointer: "/text" },
    fetcher: async () => new Response("data: not-json\n\n", { headers: { "content-type": "text/event-stream" } }),
  });
  await assert.rejects(() => call(malformedSse), (error) => error instanceof AiRuntimeError && error.code === "HTTP_SSE_INVALID");
});

test("propagates cancellation through the HTTP transport", async () => {
  const controller = new AbortController();
  const provider = createHttpModelProvider(jsonConfig({
    fetcher: async (_url, init) => await new Promise((_resolve, reject) => {
      if (init.signal.aborted) { reject(init.signal.reason); return; }
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }),
  }));
  const pending = call(provider, { signal: controller.signal });
  controller.abort(new Error("cancelled-by-test"));
  await assert.rejects(pending, /cancelled-by-test/);
});

test("times out while waiting for the next response body chunk", async () => {
  const provider = createHttpModelProvider(jsonConfig({
    timeoutMs: 20,
    fetcher: async () => new Response(new ReadableStream({ start() {} }), { status: 200 }),
  }));
  await assert.rejects(
    () => call(provider),
    (error) => error instanceof AiRuntimeError && error.code === "HTTP_PROVIDER_TIMEOUT",
  );
});
