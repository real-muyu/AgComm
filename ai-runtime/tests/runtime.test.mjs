import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRuntime } from "../dist/index.js";
import { buildAiPackageFiles, createAiPackage, createZip, readZip } from "../../../lib/ai-package.ts";
import { createAiPackageV3 } from "../../../lib/ai-package-v3.ts";
import { createAiPackageV4 } from "../../../lib/ai-package-v4.ts";
import { createAiPackageV6 } from "../../../lib/ai-package-v6.ts";
import { createAiPackageV7 } from "../../../lib/ai-package-v7.ts";
import { createPluginScaffold, finalizePlugin } from "../../../runtime/plugins/package.ts";
import { pluginSignaturePayload } from "../../../lib/plugin-runtime/signature.ts";

const fixture = new URL("../../../test-fixtures/ai/01-basic-input-output.ai", import.meta.url);

function bytesOf(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function projectWithSkill(plugin) {
  return {
    name: "CLI Runtime Test",
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "skill", title: "Skill", type: "SKILL", icon: "", x: 100, y: 0, tone: "", note: "tool_skill", outputVar: "answer", config: { skillId: "tool_skill", input: "{{user_input}}" } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "{{answer}}" } },
    ],
    edges: [{ from: "start", to: "skill" }, { from: "skill", to: "output" }],
    skills: [{ id: "tool_skill", name: "Tool Skill", description: "test", category: "test", prompt: "Use the provided tools.", pluginIds: plugin ? [plugin.id] : [] }],
    plugins: plugin ? [plugin] : [],
    variables: [
      { name: "user_input", type: "string", defaultValue: "default" },
      { name: "answer", type: "markdown", defaultValue: "" },
      { name: "final_output", type: "markdown", defaultValue: "" },
    ],
    visualizations: [],
  };
}

function plainProject() {
  return {
    name: "Plain Runtime Test",
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 100, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "plain:{{user_input}}" } },
    ],
    edges: [{ from: "start", to: "output" }],
    skills: [], plugins: [], visualizations: [],
    variables: [{ name: "user_input", type: "string", defaultValue: "default" }, { name: "final_output", type: "markdown", defaultValue: "" }],
  };
}

async function signedPlugin(mutator) {
  let plugin = await finalizePlugin(mutator(createPluginScaffold("signed_plugin", "Signed Plugin")));
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const manifest = JSON.parse(JSON.stringify({
    id: plugin.id, name: plugin.name, description: plugin.description, version: plugin.version,
    sdkVersion: plugin.sdkVersion, language: plugin.language, entry: plugin.entry, runtime: plugin.runtime, source: plugin.source,
    author: plugin.author, license: plugin.license, homepage: plugin.homepage, permissions: plugin.permissions,
    tools: plugin.tools, limits: plugin.limits, integrity: plugin.integrity,
  }));
  const signature = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, pluginSignaturePayload(manifest))).toString("base64");
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64");
  plugin = { ...plugin, signature: { algorithm: "Ed25519", keyId: "test-key", value: signature } };
  return { plugin, trustedKeys: { "test-key": publicKey } };
}

function toolCallingProvider(final = "done") {
  return {
    model: "fake-model",
    async call({ messages, tools }) {
      if (tools.length && messages.length === 2) {
        return {
          content: "",
          toolCalls: tools.map((tool, index) => ({ id: `call-${index}`, name: tool.function.name, args: {} })),
          raw: { role: "assistant", content: "" },
        };
      }
      return { content: final, toolCalls: [], raw: { role: "assistant", content: final } };
    },
  };
}

test("runs a packaged input/output flow without a model key", async () => {
  const runtime = createRuntime();
  const bytes = await readFile(fixture);
  const result = await runtime.runAiFile(new Uint8Array(bytesOf(bytes)), { input: "bash-test" });
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.match(String(result.output), /bash-test/);
  assert.equal(result.toolCalls.length, 0);
  await runtime.dispose();
});

test("imports and runs legacy JSON and v1 ZIP packages", async () => {
  const legacy = new TextEncoder().encode(JSON.stringify({
    name: "Legacy",
    nodes: [
      { id: "start", type: "START", title: "Start", x: 0, y: 0, outputVar: "" },
      { id: "output", type: "OUTPUT", title: "Output", x: 100, y: 0, outputVar: "final", config: { template: "legacy:{{user_input}}" } },
    ],
    edges: [{ from: "start", to: "output" }], skills: [], plugins: [], variables: [], visualizations: [],
  }));
  const runtime = createRuntime();
  const legacyResult = await runtime.runAiFile(legacy, { input: "v0" });
  assert.equal(legacyResult.output, "legacy:v0");

  const files = buildAiPackageFiles(plainProject());
  const manifest = JSON.parse(files["manifest.json"]);
  delete manifest.formatVersion;
  files["manifest.json"] = JSON.stringify(manifest);
  const v1Result = await runtime.runAiFile(new Uint8Array(await createZip(files).arrayBuffer()), { input: "v1" });
  assert.equal(v1Result.output, "plain:v1");
});

test("pauses at each INPUT renderer request, validates values, and resumes without repeating completed nodes", async () => {
  const project = {
    name: "Interactive Runtime",
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "first", title: "First form", type: "INPUT", icon: "", x: 100, y: 0, tone: "", note: "", outputVar: "first_values", config: {
        layout: "three-column",
        fields: [
          { id: "topic", variable: "topic", label: "Topic", component: "input", size: "large", placeholder: "topic" },
          { id: "count", variable: "count", label: "Count", component: "button", size: "small", buttonValue: "7" },
          { id: "approved", variable: "approved", label: "Approved", component: "checkbox", size: "small" },
        ],
      } },
      { id: "second", title: "Second form", type: "INPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "second_values", config: {
        layout: "single", fields: [{ id: "settings", variable: "settings", label: "Settings", component: "input", size: "medium" }],
      } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 300, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "{{topic}}/{{count}}/{{approved}}/{{settings}}" } },
    ],
    edges: [{ from: "start", to: "first" }, { from: "first", to: "second" }, { from: "second", to: "output" }],
    skills: [], plugins: [], visualizations: [],
    variables: [
      { name: "topic", type: "string", defaultValue: "default-topic" },
      { name: "count", type: "number", defaultValue: "2" },
      { name: "approved", type: "boolean", defaultValue: "false" },
      { name: "settings", type: "object", defaultValue: "{}" },
      { name: "first_values", type: "object", defaultValue: "{}" },
      { name: "second_values", type: "object", defaultValue: "{}" },
      { name: "final_output", type: "markdown", defaultValue: "" },
    ],
  };
  const calls = [];
  const lifecycle = [];
  const renderer = {
    start(value) { lifecycle.push(["start", value.projectName]); },
    async requestInput(request) {
      calls.push(request);
      if (request.node.id === "first" && !request.validationError) return { topic: "edited", count: "not-a-number", approved: true };
      if (request.node.id === "first") return { topic: "edited", count: "7", approved: true };
      return { settings: '{"mode":"safe"}' };
    },
    complete(value) { lifecycle.push(["complete", value.status]); },
    dispose() { lifecycle.push(["dispose"]); },
  };
  const bytes = new Uint8Array(await createAiPackage(project).arrayBuffer());
  const result = await createRuntime().runAiFile(bytes, { renderer });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].form.layout, "three-column");
  assert.deepEqual(calls[0].form.fields.map((field) => [field.component, field.size, field.variableType]), [
    ["input", "large", "string"], ["button", "small", "number"], ["checkbox", "small", "boolean"],
  ]);
  assert.match(calls[1].validationError, /number/);
  assert.deepEqual(calls[2].variables.first_values, { topic: "edited", count: 7, approved: true });
  assert.match(String(result.output), /edited\/7\/true/);
  assert.deepEqual(result.variables.settings, { mode: "safe" });
  assert.equal(result.records.filter((record) => record.nodeId === "start").length, 1);
  assert.equal(result.records.filter((record) => record.nodeId === "first").length, 1);
  assert.deepEqual(lifecycle, [["start", "Interactive Runtime"], ["complete", "completed"], ["dispose"]]);
});

test("supports an injected model provider for Skill nodes", async () => {
  const archive = createAiPackage(projectWithSkill());
  const runtime = createRuntime({ provider: { model: "fake-model", async call({ onEvent }) { onEvent?.({ type: "token", text: "model-result" }); return { content: "model-result" }; } } });
  const events = [];
  const result = await runtime.runAiFile(new Uint8Array(await archive.arrayBuffer()), { input: "hello", onModelEvent: (event) => events.push(event) });
  assert.equal(result.output, "model-result");
  assert.equal(result.model, "fake-model");
  assert.deepEqual(events, [{ type: "token", text: "model-result" }]);
});

test("persists multi-turn sessions by exact package hash and injects history only into top-level calls", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ai-runtime-history-"));
  const project = {
    ...projectWithSkill(),
    interaction: {
      conversation: { multiTurn: true, history: true, historyWindow: 20 },
      streaming: { defaultMode: "text" },
    },
    variables: [...projectWithSkill().variables,
      { name: "session_id", type: "string", defaultValue: "" },
      { name: "conversation_history", type: "array", defaultValue: "[]" },
      { name: "knowledge_context", type: "markdown", defaultValue: "" },
    ],
  };
  const bytes = new Uint8Array(await createAiPackageV7(project, "2026-01-01T00:00:00.000Z").arrayBuffer());
  const calls = [];
  const provider = { model: "history-model", async call({ messages }) { calls.push(messages); const input = messages.at(-1)?.content; return { content: `reply:${input}` }; } };
  const firstRuntime = createRuntime({ provider, dataDir });
  const firstApp = await firstRuntime.openAiApp(bytes);
  const session = await firstApp.createSession();
  const sessionId = session.id;
  await session.runTurn("first");
  await firstRuntime.dispose();

  const secondRuntime = createRuntime({ provider, dataDir });
  const secondApp = await secondRuntime.openAiApp(bytes);
  assert.equal((await secondApp.listSessions())[0].id, sessionId);
  const restored = await secondApp.openSession(sessionId);
  const streamedTurn = restored.streamTurn("second", { mode: "text" });
  const chunks = [];
  for await (const chunk of streamedTurn) chunks.push(chunk);
  assert.deepEqual(chunks, ["reply:second"]);
  await streamedTurn.result;
  assert.deepEqual((await restored.history()).map(({ role, content }) => [role, content]), [
    ["user", "first"], ["assistant", "reply:first"], ["user", "second"], ["assistant", "reply:second"],
  ]);
  assert.ok(calls.at(-1).some((message) => message.role === "assistant" && message.content === "reply:first"));
  const cancelledTurn = restored.streamTurn("cancelled");
  cancelledTurn.cancel();
  await assert.rejects(cancelledTurn.result);
  assert.deepEqual((await restored.history()).slice(-2).map(({ role, content }) => [role, content]), [
    ["assistant", "reply:second"], ["user", "cancelled"],
  ]);

  const changed = new Uint8Array(await createAiPackageV7(project, "2026-01-02T00:00:00.000Z").arrayBuffer());
  const changedApp = await secondRuntime.openAiApp(changed);
  assert.notEqual(changedApp.id, secondApp.id);
  assert.deepEqual(await changedApp.listSessions(), []);
  await secondRuntime.dispose();
});

test("indexes app and session knowledge with embeddings and preserves failed sources", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ai-runtime-knowledge-"));
  const sourceDir = await mkdtemp(join(tmpdir(), "ai-runtime-sources-"));
  const appSource = join(sourceDir, "app.md");
  const sessionSource = join(sourceDir, "session.txt");
  await writeFile(appSource, "Alpha project policy and release instructions.");
  await writeFile(sessionSource, "Beta private session notes.");
  const project = {
    ...projectWithSkill(),
    interaction: {
      conversation: { multiTurn: true, history: true, historyWindow: 20 },
      knowledge: { enabled: true, scopes: ["app", "session"], topK: 6, chunkSize: 200, chunkOverlap: 20 },
    },
    variables: [...projectWithSkill().variables,
      { name: "session_id", type: "string", defaultValue: "" },
      { name: "conversation_history", type: "array", defaultValue: "[]" },
      { name: "knowledge_context", type: "markdown", defaultValue: "" },
    ],
  };
  const bytes = new Uint8Array(await createAiPackage(project, "2026-02-01T00:00:00.000Z").arrayBuffer());
  const seen = [];
  const embeddingProvider = {
    model: "mock-embedding",
    async embed({ texts }) { return texts.map((text) => [String(text).toLowerCase().includes("alpha") ? 1 : 0, String(text).toLowerCase().includes("beta") ? 1 : 0, 0.1]); },
  };
  const runtime = createRuntime({
    dataDir, embeddingProvider,
    provider: { model: "knowledge-model", async call({ messages }) { seen.push(messages); return { content: "grounded" }; } },
  });
  const app = await runtime.openAiApp(bytes);
  const session = await app.createSession({ title: "Knowledge" });
  const progress = [];
  await app.importKnowledge([appSource], { scope: { type: "app" }, onProgress: (event) => progress.push(event.phase) });
  assert.deepEqual(progress, ["copy", "parse", "chunk", "embed", "complete"]);
  await app.importKnowledge([sessionSource], { scope: { type: "session", sessionId: session.id } });
  assert.equal((await app.listKnowledge({ type: "app" }))[0].status, "ready");
  assert.equal((await app.listKnowledge({ type: "session", sessionId: session.id }))[0].status, "ready");
  const result = await session.runTurn("Tell me about alpha and beta");
  assert.match(result.variables.knowledge_context, /Alpha project policy/);
  assert.match(result.variables.knowledge_context, /Beta private session notes/);
  assert.ok(seen.at(-1).some((message) => message.role === "system" && /untrusted reference material/.test(message.content)));
  await runtime.dispose();

  const noEmbeddingRuntime = createRuntime({ dataDir: await mkdtemp(join(tmpdir(), "ai-runtime-no-embedding-")) });
  const noEmbeddingApp = await noEmbeddingRuntime.openAiApp(bytes);
  await assert.rejects(() => noEmbeddingApp.importKnowledge([appSource], { scope: { type: "app" } }), (error) => error.code === "EMBEDDING_PROVIDER_REQUIRED");
  const failed = await noEmbeddingApp.listKnowledge({ type: "app" });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, "failed");
  await noEmbeddingRuntime.dispose();
});

test("supports custom knowledge parsers, explicit reindexing, and corrupt-index recovery", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ai-runtime-custom-knowledge-"));
  const sourceDir = await mkdtemp(join(tmpdir(), "ai-runtime-custom-source-"));
  const source = join(sourceDir, "facts.note");
  await writeFile(source, "custom facts");
  const project = {
    ...plainProject(),
    interaction: { knowledge: { enabled: true, scopes: ["app"], topK: 2, chunkSize: 200, chunkOverlap: 20 } },
  };
  const bytes = new Uint8Array(await createAiPackage(project, "2026-03-01T00:00:00.000Z").arrayBuffer());
  const embeddingProvider = { model: "custom-vectors", async embed({ texts }) { return texts.map((text) => [String(text).length, 1]); } };
  const parser = {
    id: "note-parser", version: "7", extensions: [".note"],
    async parse({ bytes: contents }) { return `PARSED:${new TextDecoder().decode(contents)}`; },
  };
  const runtime = createRuntime({ dataDir, embeddingProvider, knowledgeParsers: [parser] });
  const app = await runtime.openAiApp(bytes);
  const [document] = await app.importKnowledge([source], { scope: { type: "app" } });
  assert.equal(document.parserId, "note-parser");
  assert.equal(document.parserVersion, "7");
  const [reindexed] = await app.reindexKnowledge(undefined, { scope: { type: "app" } });
  assert.equal(reindexed.status, "ready");
  await writeFile(join(dataDir, app.id, "knowledge", "app", "vectors.f32"), new Uint8Array());
  await runtime.dispose();

  const reopenedRuntime = createRuntime({ dataDir, embeddingProvider, knowledgeParsers: [parser] });
  const reopened = await reopenedRuntime.openAiApp(bytes);
  const recovered = await reopened.listKnowledge({ type: "app" });
  assert.equal(recovered[0].status, "failed");
  assert.match(recovered[0].error, /rebuilding/i);
  await reopenedRuntime.dispose();
});

test("streams OpenAI-compatible text chunks through model events while preserving the final reply", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const chunks = [
    { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: "Hel" }, finish_reason: null }] },
    { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }] },
    { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/8\.8\.8\.8\/v1\/chat\/completions/);
    assert.equal(init.redirect, "manual");
    return new Response(new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const events = [];
    const bytes = new Uint8Array(await createAiPackage(projectWithSkill()).arrayBuffer());
    const result = await createRuntime({ provider: { apiKey: "test-key", baseUrl: "https://8.8.8.8/v1", model: "test-model" } })
      .runAiFile(bytes, { input: "hello", onModelEvent: (event) => events.push(event) });
    assert.equal(result.output, "Hello");
    assert.deepEqual(events.filter((event) => event.type === "token").map((event) => event.text), ["Hel", "lo"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("streams v7 final text and contextual events while preserving the result", async () => {
  const project = {
    ...projectWithSkill(),
    interaction: { streaming: { defaultMode: "events" } },
  };
  const bytes = new Uint8Array(await createAiPackageV7(project).arrayBuffer());
  const provider = {
    model: "stream-fake",
    async call({ onEvent }) {
      onEvent?.({ type: "token", text: "Hel" });
      onEvent?.({ type: "token", text: "lo" });
      return { content: "Hello" };
    },
  };
  const runtime = createRuntime({ provider });
  const app = await runtime.openAiApp(bytes);
  assert.equal(app.info.formatVersion, 7);

  const textStream = app.stream({ mode: "text", input: "hello" });
  const text = [];
  for await (const chunk of textStream) text.push(chunk);
  assert.deepEqual(text, ["Hel", "lo"]);
  assert.equal((await textStream.result).output, "Hello");

  const eventStream = app.stream({ mode: "events", input: "hello" });
  const events = [];
  for await (const event of eventStream) events.push(event);
  assert.equal((await eventStream.result).output, "Hello");
  assert.equal(events[0].type, "run-start");
  assert.equal(events.at(-1).type, "result");
  assert.deepEqual(events.map((event) => event.sequence), events.map((_event, index) => index + 1));
  const model = events.find((event) => event.type === "model-event");
  assert.equal(model.context.nodeId, "skill");
  assert.equal(model.context.skillId, "tool_skill");
  assert.equal(model.context.purpose, "skill");
  assert.ok(events.some((event) => event.type === "output-delta" && event.text === "Hel"));
  await app.dispose();
  await runtime.dispose();
});

test("text streaming buffers transformed OUTPUT values as one exact chunk", async () => {
  const project = projectWithSkill();
  project.nodes.find((node) => node.id === "output").config.template = "prefix:{{answer}}";
  const bytes = new Uint8Array(await createAiPackage(project).arrayBuffer());
  const provider = {
    model: "stream-fake",
    async call({ onEvent }) {
      onEvent?.({ type: "token", text: "raw" });
      return { content: "raw" };
    },
  };
  const runtime = createRuntime({ provider });
  const stream = await runtime.streamAiFile(bytes, { mode: "text" });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(chunks, ["prefix:raw"]);
  assert.equal((await stream.result).output, "prefix:raw");
  await runtime.dispose();
});

test("ordinary run callbacks receive ordered stream events and callback failures abort the run", async () => {
  const bytes = new Uint8Array(await createAiPackageV7(projectWithSkill()).arrayBuffer());
  const provider = {
    model: "stream-callback-fake",
    async call({ onEvent }) {
      onEvent?.({ type: "token", text: "one" });
      onEvent?.({ type: "token", text: " two" });
      return { content: "one two" };
    },
  };
  const runtime = createRuntime({ provider });
  const events = [];
  const deltas = [];
  const result = await runtime.runAiFile(bytes, {
    mode: "events",
    onStreamEvent: (event) => events.push(event),
    onOutputDelta: (text) => deltas.push(text),
  });
  assert.equal(result.output, "one two");
  assert.deepEqual(deltas, ["one", " two"]);
  assert.equal(events[0].type, "run-start");
  assert.equal(events[0].mode, "events");
  assert.equal(events.at(-1).type, "result");
  assert.deepEqual(events.map((event) => event.sequence), events.map((_event, index) => index + 1));
  await assert.rejects(
    () => runtime.runAiFile(bytes, { onStreamEvent: () => { throw new Error("callback failed"); } }),
    (error) => error.code === "STREAM_CALLBACK_FAILED",
  );
  await runtime.dispose();
});

test("stopping a stream consumer cancels execution", async () => {
  const bytes = new Uint8Array(await createAiPackageV7(projectWithSkill()).arrayBuffer());
  const provider = {
    model: "stream-cancel-fake",
    async call({ onEvent, signal }) {
      onEvent?.({ type: "token", text: "first" });
      await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      return { content: "unreachable" };
    },
  };
  const runtime = createRuntime({ provider });
  const stream = await runtime.streamAiFile(bytes, { mode: "text" });
  for await (const chunk of stream) {
    assert.equal(chunk, "first");
    break;
  }
  assert.equal(stream.signal.aborted, true);
  await assert.rejects(stream.result, (error) => error.name === "AbortError" || error.name === "FlowCancelledError");
  await runtime.dispose();
});

test("slow stream consumers are stopped at the 1 MiB buffer limit", async () => {
  const bytes = new Uint8Array(await createAiPackageV7(projectWithSkill()).arrayBuffer());
  const chunk = "x".repeat(2_048);
  const provider = {
    model: "stream-backpressure-fake",
    async call({ onEvent }) {
      for (let index = 0; index < 600; index++) onEvent?.({ type: "token", text: chunk });
      return { content: chunk.repeat(600) };
    },
  };
  const runtime = createRuntime({ provider });
  const stream = await runtime.streamAiFile(bytes, { mode: "text" });
  await assert.rejects(stream.result, (error) => error.code === "STREAM_BACKPRESSURE_EXCEEDED");
  await runtime.dispose();
});

test("event streams emit one error event while result rejects", async () => {
  const bytes = new Uint8Array(await createAiPackageV7(projectWithSkill()).arrayBuffer());
  const runtime = createRuntime({
    provider: {
      model: "stream-error-fake",
      async call() { throw new Error("provider unavailable"); },
    },
  });
  const stream = await runtime.streamAiFile(bytes, { mode: "events" });
  const rejected = stream.result.catch((error) => error);
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal(events.filter((event) => event.type === "error").length, 1);
  assert.equal(events.at(-1).type, "error");
  assert.match((await rejected).message, /provider unavailable/);
  await runtime.dispose();
});

test("runs Workspace tool calling with an injected provider", async () => {
  const project = {
    ...plainProject(),
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "workspace", title: "Workspace", type: "WORKSPACE", icon: "", x: 100, y: 0, tone: "", note: "", outputVar: "answer", workspace: { agentSkillId: "agent", skillIds: ["child"], maxIterations: 3 } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "{{answer}}" } },
    ],
    edges: [{ from: "start", to: "workspace" }, { from: "workspace", to: "output" }],
    skills: [
      { id: "agent", name: "Agent", description: "agent", category: "test", prompt: "Delegate.", pluginIds: [] },
      { id: "child", name: "Child", description: "child", category: "test", prompt: "Answer.", pluginIds: [] },
    ],
    variables: [...plainProject().variables, { name: "answer", type: "markdown", defaultValue: "" }],
  };
  const provider = {
    model: "workspace-fake",
    async call({ messages, tools }) {
      if (!tools.length) return { content: "child-result" };
      if (messages.length === 2) return { content: "", toolCalls: [{ id: "skill-call", name: tools[0].function.name, args: { input: "delegated" } }], raw: { role: "assistant", content: "" } };
      return { content: "workspace-final" };
    },
  };
  const result = await createRuntime({ provider }).runAiFile(new Uint8Array(await createAiPackage(project).arrayBuffer()));
  assert.equal(result.output, "workspace-final");
  assert.ok(result.toolCalls.some((call) => call.skillId === "child"));
});

test("rejects non-HTTPS and private HTTP node targets", async () => {
  const project = {
    ...plainProject(),
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "http", title: "HTTP", type: "HTTP", icon: "", x: 100, y: 0, tone: "", note: "", outputVar: "response", config: { method: "GET", url: "http://127.0.0.1/private" } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output" },
    ],
    edges: [{ from: "start", to: "http" }, { from: "http", to: "output" }],
    variables: [...plainProject().variables, { name: "response", type: "object", defaultValue: "{}" }],
  };
  const archive = createAiPackage(project);
  const archiveBytes = new Uint8Array(await archive.arrayBuffer());
  await assert.rejects(
    () => createRuntime().runAiFile(archiveBytes),
    /HTTPS|公网|public/i,
  );
});

test("executes a trusted signed permissionless plugin in the restricted worker", async () => {
  const { plugin, trustedKeys } = await signedPlugin((value) => ({
    ...value,
    tools: [{ name: "probe", description: "probe globals", permissions: [] }],
    bundleCode: "export default { tools: { probe: { async run() { return JSON.stringify({ processType: typeof process, fetchType: typeof fetch }); } } } };",
  }));
  const archive = createAiPackage(projectWithSkill(plugin));
  const runtime = createRuntime({ provider: toolCallingProvider(), trustedKeys });
  const result = await runtime.runAiFile(new Uint8Array(await archive.arrayBuffer()));
  assert.equal(result.output, "done");
  assert.equal(result.toolCalls.length, 1);
  assert.match(result.toolCalls[0].output, /"processType":"undefined"/);
  assert.match(result.toolCalls[0].output, /"fetchType":"undefined"/);
});

test("waits for plugin worker readiness before concurrent first tool calls", async () => {
  const plugin = await finalizePlugin({
    ...createPluginScaffold("parallel_plugin", "Parallel Plugin"),
    tools: [
      { name: "alpha", description: "alpha tool", permissions: [] },
      { name: "beta", description: "beta tool", permissions: [] },
    ],
    bundleCode: `await new Promise((resolve) => setTimeout(resolve, 25));
export default {
  tools: {
    alpha: { async run() { return "alpha-ready"; } },
    beta: { async run() { return "beta-ready"; } },
  },
};`,
  });
  const runtime = createRuntime({ provider: toolCallingProvider(), allowUnsignedPlugins: true });
  const result = await runtime.runAiFile(new Uint8Array(await createAiPackage(projectWithSkill(plugin)).arrayBuffer()));
  assert.equal(result.output, "done");
  assert.deepEqual(result.toolCalls.map((call) => call.output).sort(), ["alpha-ready", "beta-ready"]);
  await runtime.dispose();
});

test("rejects unsigned and unknown-publisher plugins", async () => {
  const unsigned = await finalizePlugin(createPluginScaffold("unsigned_plugin", "Unsigned"));
  const unsignedArchive = createAiPackage(projectWithSkill(unsigned));
  const unsignedBytes = new Uint8Array(await unsignedArchive.arrayBuffer());
  await assert.rejects(
    () => createRuntime({ provider: toolCallingProvider() }).runAiFile(unsignedBytes),
    /unsigned/,
  );

  const { plugin } = await signedPlugin((value) => value);
  const signedArchive = createAiPackage(projectWithSkill(plugin));
  const signedBytes = new Uint8Array(await signedArchive.arrayBuffer());
  await assert.rejects(
    () => createRuntime({ provider: toolCallingProvider() }).runAiFile(signedBytes),
    /publisher is not trusted/,
  );
});

test("routes all seven desktop permissions through explicit grants and adapters", async () => {
  const permissions = ["filesystem:read", "filesystem:write", "document:read", "document:write", "clipboard:read", "clipboard:write", "screen:read"];
  const tools = permissions.map((permission, index) => ({ name: `permission${index}`, description: permission, permissions: [permission] }));
  const handlers = permissions.map((permission, index) => `permission${index}: { async run(input, context) { return context.call(${JSON.stringify(permission)}, input); } }`).join(",");
  const { plugin, trustedKeys } = await signedPlugin((value) => ({
    ...value,
    permissions,
    tools,
    bundleCode: `export default { tools: { ${handlers} } };`,
  }));
  const archive = createAiPackage(projectWithSkill(plugin));
  const bytes = new Uint8Array(await archive.arrayBuffer());
  await assert.rejects(
    () => createRuntime({ provider: toolCallingProvider(), trustedKeys, grants: { [plugin.id]: permissions } }).runAiFile(bytes),
    /Host does not implement permission/,
  );

  const seen = new Set();
  const adapter = Object.fromEntries(permissions.map((permission) => [permission, async () => { seen.add(permission); return { permission }; }]));
  const runtime = createRuntime({ provider: toolCallingProvider(), trustedKeys, grants: { [plugin.id]: permissions }, permissions: adapter });
  const result = await runtime.runAiFile(bytes);
  assert.equal(result.output, "done");
  assert.deepEqual(seen, new Set(permissions));
});

async function codePlugin(overrides = {}) {
  const base = createPluginScaffold("regex_code", "Regex Code");
  return finalizePlugin({
    ...base,
    description: "Extract regular expression matches",
    permissions: [],
    tools: [{
      name: "run",
      description: "Extract matches",
      inputSchema: { type: "object", properties: { text: { type: "string" }, pattern: { type: "string" } }, required: ["text", "pattern"], additionalProperties: false },
      outputSchema: { type: "object", properties: { matches: { type: "array", items: { type: "string" } } }, required: ["matches"], additionalProperties: false },
      permissions: [],
    }],
    bundleCode: "export default { run(input, context) { context.checkAborted(); return { matches: [...input.text.matchAll(new RegExp(input.pattern, 'g'))].map((item) => item[0]) }; } };",
    ...overrides,
  });
}

function codeProject(plugin, input = { text: "{{user_input}}", pattern: "[A-Z]+" }) {
  return {
    name: "Runtime Code Test",
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "extract", title: "Extract", type: "CODE", icon: "", x: 100, y: 0, tone: "", note: plugin.id, outputVar: "matches", config: { codeId: plugin.id, input } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "{{matches}}" } },
    ],
    edges: [{ from: "start", to: "extract" }, { from: "extract", to: "output" }],
    skills: [], plugins: [plugin], visualizations: [],
    variables: [
      { name: "user_input", type: "string", defaultValue: "" },
      { name: "matches", type: "object", defaultValue: "{}" },
      { name: "final_output", type: "object", defaultValue: "{}" },
    ],
  };
}

test("loads v3 CODE nodes, validates schemas, and runs them without a model provider", async () => {
  const plugin = await codePlugin();
  const archive = createAiPackageV3(codeProject(plugin));
  const bytes = new Uint8Array(await archive.arrayBuffer());
  await assert.rejects(() => createRuntime().runAiFile(bytes, { input: "ABC xyz" }), /unsigned/);
  const runtime = createRuntime({ allowUnsignedPlugins: true });
  assert.deepEqual((await runtime.runAiFile(bytes, { input: "ABC xyz" })).output, { matches: ["ABC"] });

  const invalidInput = new Uint8Array(await createAiPackageV3(codeProject(plugin, { text: 42, pattern: "x" })).arrayBuffer());
  await assert.rejects(() => runtime.runAiFile(invalidInput), /应为 string/);

  const invalidOutputPlugin = await codePlugin({ bundleCode: "export default { run() { return 'not-an-object'; } };" });
  const invalidOutput = new Uint8Array(await createAiPackageV3(codeProject(invalidOutputPlugin)).arrayBuffer());
  await assert.rejects(() => runtime.runAiFile(invalidOutput, { input: "ABC" }), /应为 object/);
  await runtime.dispose();
});

test("loads v4 Runtime bundles, exposes package info and emits flow events through dynamic trust", async () => {
  const plugin = await codePlugin({ runtime: "runtime" });
  const bytes = new Uint8Array(await createAiPackageV4(codeProject(plugin)).arrayBuffer());
  const requests = [];
  const events = [];
  const runtime = createRuntime({
    trustProvider: {
      async authorize(request) {
        requests.push(request);
        return { trusted: true, allowUnsigned: true, grants: request.permissions };
      },
    },
  });
  const app = await runtime.openAiApp(bytes);
  assert.equal(app.info.formatVersion, 4);
  assert.equal(app.info.packageHash, app.packageHash);
  assert.equal(app.info.bundles[0].runtime, "runtime");
  assert.equal(app.info.bundles[0].kind, "code");
  const result = await app.run({ input: "ABC xyz", onRuntimeEvent: (event) => events.push(event) });
  assert.deepEqual(result.output, { matches: ["ABC"] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].packageHash, app.packageHash);
  assert.ok(events.some((event) => event.type === "flow" && event.event.type === "node:start"));
  await app.dispose();
  await runtime.dispose();
});

async function workspaceHookPlugin() {
  const base = createPluginScaffold("workspace_policy", "Workspace Policy");
  const operations = ["onStart", "beforeModel", "afterModel", "beforeTool", "afterTool", "onFinish", "onError"];
  const plugin = await finalizePlugin({
    ...base,
    runtime: "runtime",
    description: "Workspace lifecycle test hook",
    permissions: [],
    tools: operations.map((name) => ({
      name,
      description: `Workspace Hook ${name}`,
      inputSchema: { type: "object" },
      outputSchema: name === "onError" ? { type: "null" } : { type: ["object", "null"] },
      permissions: [],
    })),
    bundleCode: `export default { tools: {
      onStart: { run(event) { return { input: event.input.trim(), variables: { hook_local: "yes" }, state: { calls: 0 } }; } },
      beforeModel: { run(event) { return { systemInstruction: "local=" + event.variables.hook_local, state: event.state }; } },
      afterModel: { run(event) { return { content: event.content ? event.content + ":model" : event.content, state: event.state }; } },
      beforeTool: { run(event) { return { skipWith: "cached", state: { calls: event.state.calls + 1 } }; } },
      afterTool: { run(event) { return { output: event.output + ":after", state: event.state }; } },
      onFinish: { run(event) { return { output: event.output + ":finish:" + event.state.calls, state: event.state }; } },
      onError: { run(event, context) { context.log("warn", "observed workspace error", { stage: event.stage }); return null; } }
    } };`,
  });
  return { ...plugin, kind: "workspace-hook" };
}

test("runs v6 Workspace Hooks with local variables, state, tool short-circuiting, and lifecycle events", async () => {
  const hook = await workspaceHookPlugin();
  const project = {
    name: "Workspace Hook Runtime",
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "workspace", title: "Workspace", type: "WORKSPACE", icon: "", x: 100, y: 0, tone: "", note: "", outputVar: "answer", workspace: { agentSkillId: "agent", skillIds: ["child"], maxIterations: 3 }, config: { agentSkillId: "agent", skillIds: ["child"], maxIterations: 3, input: "{{user_input}}", hookIds: [hook.id] } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "{{answer}}" } },
    ],
    edges: [{ from: "start", to: "workspace" }, { from: "workspace", to: "output" }],
    skills: [
      { id: "agent", name: "Agent", description: "Agent", category: "test", prompt: "Coordinate {{hook_local}}", pluginIds: [] },
      { id: "child", name: "Child", description: "Child", category: "test", prompt: "Execute", pluginIds: [] },
    ],
    plugins: [hook],
    variables: [
      { name: "user_input", type: "string", defaultValue: "" },
      { name: "answer", type: "markdown", defaultValue: "" },
      { name: "final_output", type: "markdown", defaultValue: "" },
    ],
    visualizations: [],
  };
  const bytes = new Uint8Array(await createAiPackageV6(project).arrayBuffer());
  const requests = [];
  const events = [];
  const provider = {
    model: "hook-model",
    async call({ messages, tools }) {
      requests.push(messages);
      if (tools.length && !messages.some((message) => message?.role === "tool" || message?._getType?.() === "tool")) {
        return { content: "", toolCalls: [{ id: "call-child", name: tools[0].function.name, args: { input: "real" } }], raw: { role: "assistant", content: "", tool_calls: [{ id: "call-child", name: tools[0].function.name, args: { input: "real" } }] } };
      }
      return { content: "base", toolCalls: [], raw: { role: "assistant", content: "base" } };
    },
  };
  const runtime = createRuntime({ provider, allowUnsignedPlugins: true });
  const app = await runtime.openAiApp(bytes);
  assert.equal(app.info.formatVersion, 6);
  assert.equal(app.info.bundles[0].kind, "hook");
  const result = await app.run({ input: " request ", onRuntimeEvent: (event) => events.push(event) });
  assert.equal(result.output, "base:model:finish:1");
  assert.equal(result.toolCalls[0].output, "cached:after");
  assert.equal(requests.length, 2);
  assert.ok(requests[0].some((message) => message?.role === "system" && String(message.content).includes("local=yes")));
  assert.ok(events.some((event) => event.type === "hook" && event.stage === "beforeTool" && event.status === "complete"));
  await app.dispose();
  await runtime.dispose();

  const failureEvents = [];
  const failingRuntime = createRuntime({
    provider: { model: "failing-hook-model", async call() { throw new Error("provider failed"); } },
    allowUnsignedPlugins: true,
  });
  const failingApp = await failingRuntime.openAiApp(bytes);
  await assert.rejects(() => failingApp.run({ input: "request", onRuntimeEvent: (event) => failureEvents.push(event) }), /provider failed/);
  assert.ok(failureEvents.some((event) => event.type === "hook" && event.stage === "onError" && event.status === "complete"));
  assert.ok(failureEvents.some((event) => event.type === "plugin-log" && event.log.message === "observed workspace error"));
  await failingApp.dispose();
  await failingRuntime.dispose();
});

test("CODE nodes reuse plugin integrity and explicit permission enforcement", async () => {
  const permission = "clipboard:read";
  const plugin = await codePlugin({
    permissions: [permission],
    tools: [{
      name: "run", description: "Read clipboard",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
      permissions: [permission],
    }],
    bundleCode: `export default { async run(_input, context) { return context.call(${JSON.stringify(permission)}); } };`,
  });
  const bytes = new Uint8Array(await createAiPackageV3(codeProject(plugin, {})).arrayBuffer());
  await assert.rejects(() => createRuntime({ allowUnsignedPlugins: true }).runAiFile(bytes), /permission was not granted/);
  const runtime = createRuntime({
    allowUnsignedPlugins: true,
    grants: { [plugin.id]: [permission] },
    permissions: { [permission]: async () => ({ value: "clipboard" }) },
  });
  assert.deepEqual((await runtime.runAiFile(bytes)).output, { value: "clipboard" });
  await runtime.dispose();

  const files = await readZip(bytesOf(bytes));
  files[`plugins/${plugin.id}/dist/index.js`] += "\n// tampered";
  const tampered = new Uint8Array(await createZip(files).arrayBuffer());
  await assert.rejects(() => createRuntime({ allowUnsignedPlugins: true }).runAiFile(tampered), /integrity/);
});
