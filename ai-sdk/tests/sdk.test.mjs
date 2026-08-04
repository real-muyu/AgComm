import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  AiSdkError,
  buildAi,
  compileApp,
  createAppRunner,
  defineCode,
  defineFlowHook,
  defineWorkspaceHook,
  defineApp,
  defineSkill,
  installBackgroundApp,
  runApp,
  streamApp,
  template,
  variable,
  writeAi,
} from "../dist/index.js";
import { definePlugin, defineTool } from "../dist/plugin.js";
import { createZip, parseAiPackage, readZip } from "../../../lib/ai-package.ts";
import { parseAiPackageV6 } from "../../../lib/ai-package-v6.ts";
import { parseAiPackageV7 } from "../../../lib/ai-package-v7.ts";
import { parseAiPackageV8 } from "../../../lib/ai-package-v8.ts";

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function pluginFixture() {
  const directory = await mkdtemp(join(tmpdir(), "ai-sdk-plugin-"));
  const entry = join(directory, "text-tools.plugin.ts");
  await writeFile(entry, `import { definePlugin, defineTool } from "@agcomm/ai-sdk/plugin";
export default definePlugin({
  entry: import.meta.url,
  id: "text_tools",
  name: "Text Tools",
  version: "1.0.0",
  permissions: [],
  tools: {
    normalize: defineTool({
      description: "Normalize text",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
      async run(input, context) { context.checkAborted(); return { text: String(input.text || "").trim() }; }
    })
  }
});
`, "utf8");
  return definePlugin({
    entry: pathToFileURL(entry).href,
    id: "text_tools",
    name: "Text Tools",
    version: "1.0.0",
    permissions: [],
    tools: {
      normalize: defineTool({
        description: "Normalize text",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        async run(input, context) { context.checkAborted(); return { text: String(input.text || "").trim() }; },
      }),
    },
  });
}

async function hookFixture() {
  const directory = await mkdtemp(join(tmpdir(), "ai-sdk-hook-"));
  const entry = join(directory, "workspace-policy.hook.ts");
  await writeFile(entry, `import { defineWorkspaceHook } from "@agcomm/ai-sdk/hook";
export default defineWorkspaceHook({
  entry: import.meta.url,
  id: "workspace_policy",
  name: "Workspace Policy",
  description: "Normalizes Workspace execution",
  version: "1.0.0",
  permissions: [],
  handlers: {
    onStart(event) { return { input: event.input.trim(), variables: { hook_started: true }, state: { calls: 0 } }; },
    beforeTool(event) { return { input: event.input, state: event.state }; },
    afterTool(event) { return { output: event.output, state: event.state }; },
    onFinish(event) { return { output: event.output + "!", state: event.state }; }
  }
});
`, "utf8");
  return defineWorkspaceHook({
    entry: pathToFileURL(entry).href,
    id: "workspace_policy",
    name: "Workspace Policy",
    description: "Normalizes Workspace execution",
    version: "1.0.0",
    permissions: [],
    handlers: {
      onStart(event) { return { input: event.input.trim(), variables: { hook_started: true }, state: { calls: 0 } }; },
      beforeTool(event) { return { input: event.input, state: event.state }; },
      afterTool(event) { return { output: event.output, state: event.state }; },
      onFinish(event) { return { output: `${event.output}!`, state: event.state }; },
    },
  });
}

async function flowHookFixture() {
  const directory = await mkdtemp(join(tmpdir(), "ai-sdk-flow-hook-"));
  const entry = join(directory, "http-policy.flow-hook.ts");
  await writeFile(entry, `import { defineFlowHook } from "@agcomm/ai-sdk/flow-hook";
export default defineFlowHook({
  entry: import.meta.url,
  id: "http_policy",
  name: "HTTP Policy",
  description: "Rewrites HTTP regions and recovers exhausted requests",
  version: "1.0.0",
  handlers: {
    beforeNode(event) {
      if (event.node.type !== "HTTP") return;
      return { config: { ...event.node.config, url: String(event.node.config.url).replace("region=APAC", "region=global") }, state: { rewritten: true } };
    },
    onNodeError(event) {
      if (event.node.id === "market_request") return { recoverWith: { status: 200, headers: {}, body: { region: "fallback" } }, state: event.state };
    }
  }
});
`, "utf8");
  return defineFlowHook({
    entry: pathToFileURL(entry).href,
    id: "http_policy",
    name: "HTTP Policy",
    description: "Rewrites HTTP regions and recovers exhausted requests",
    version: "1.0.0",
    handlers: {
      beforeNode(event) {
        if (event.node.type !== "HTTP") return;
        return { config: { ...event.node.config, url: String(event.node.config.url).replace("region=APAC", "region=global") }, state: { rewritten: true } };
      },
      onNodeError(event) {
        if (event.node.id === "market_request") return { recoverWith: { status: 200, headers: {}, body: { region: "fallback" } }, state: event.state };
      },
    },
  });
}

test("Flow Hooks rewrite standalone HTTP nodes and recover after retries are exhausted", async () => {
  const hook = await flowHookFixture();
  const app = defineApp({ name: "Flow Hook App", hooks: [hook] }, ({ flow }) => {
    const request = flow.http({ id: "market_request", url: "https://8.8.8.8/market?region=APAC", after: [] });
    flow.output({ id: "result", value: request });
  });
  const compiled = await compileApp(app);
  assert.equal(compiled.formatVersion, 8);
  assert.deepEqual(compiled.project.flowHookIds, ["http_policy"]);
  assert.equal(compiled.project.plugins.find((bundle) => bundle.id === "http_policy").kind, "flow-hook");
  const restored = await parseAiPackageV8(arrayBufferOf(await buildAi(app)), "flow-hook");
  assert.deepEqual(restored.flowHookIds, ["http_policy"]);
  assert.throws(() => defineApp({ name: "Duplicate Flow Hook", hooks: [hook, hook] }, ({ flow }) => flow.output({ id: "result" })), (error) => error.code === "DUPLICATE_FLOW_HOOK");

  const invalidFiles = await readZip(arrayBufferOf(await buildAi(app)));
  const invalidFlow = JSON.parse(invalidFiles["flow/flow.json"]);
  invalidFlow.config.hookIds = ["missing_hook"];
  invalidFiles["flow/flow.json"] = JSON.stringify(invalidFlow);
  const invalidArchive = await createZip(invalidFiles).arrayBuffer();
  await assert.rejects(() => parseAiPackageV8(invalidArchive, "invalid-flow-hook"), (error) => error.code === "REFERENCE_INVALID");

  const originalFetch = globalThis.fetch;
  const urls = [];
  const events = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ error: "upstream" }), { status: 503, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runApp(app, {
      runtime: { allowUnsignedPlugins: true },
      run: { onRuntimeEvent: (event) => events.push(event) },
    });
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.includes("region=global")));
    assert.deepEqual(result.output, { status: 200, headers: {}, body: { region: "fallback" } });
    assert.ok(events.some((event) => event.type === "flow-hook" && event.stage === "beforeNode"));
    assert.ok(events.some((event) => event.type === "flow-hook" && event.stage === "onNodeError"));
  } finally { globalThis.fetch = originalFetch; }
});

test("collects Workspace Hooks once and round-trips v8 hook references", async () => {
  const hook = await hookFixture();
  const agent = defineSkill({ id: "hook_agent", name: "Hook Agent", prompt: "Coordinate" });
  const child = defineSkill({ id: "hook_child", name: "Hook Child", prompt: "Execute {{skill_input}}" });
  const app = defineApp({ name: "Hook App", skills: [agent, child] }, ({ flow }) => {
    const first = flow.workspace({ id: "hook_workspace_one", agent, skills: [child], hooks: [hook], input: "one" });
    const second = flow.workspace({ id: "hook_workspace_two", agent, skills: [child], hooks: [hook], input: first });
    flow.output({ id: "hook_output", value: second });
  });
  const compiled = await compileApp(app);
  assert.equal(compiled.formatVersion, 8);
  assert.equal(compiled.project.plugins.filter((bundle) => bundle.kind === "workspace-hook").length, 1);
  assert.deepEqual(compiled.project.nodes.filter((node) => node.type === "WORKSPACE").map((node) => node.config.hookIds), [["workspace_policy"], ["workspace_policy"]]);
  const bytes = await buildAi(app);
  const restored = await parseAiPackageV8(arrayBufferOf(bytes), "hooks");
  assert.equal(restored.plugins.find((bundle) => bundle.id === "workspace_policy").kind, "workspace-hook");
  await assert.rejects(() => parseAiPackageV7(arrayBufferOf(bytes), "v7-importer"), /不支持.*8|formatVersion/);
  await assert.rejects(() => parseAiPackageV6(arrayBufferOf(bytes), "v6-importer"), /不支持.*8|formatVersion/);
  await assert.rejects(() => parseAiPackage(arrayBufferOf(bytes), "legacy-importer"), /不支持.*8/);
  assert.throws(() => defineApp({ name: "Duplicate Hook", skills: [agent, child] }, ({ flow }) => {
    const value = flow.workspace({ id: "duplicate_workspace", agent, skills: [child], hooks: [hook, hook] });
    flow.output({ id: "duplicate_output", value });
  }), (error) => error.code === "DUPLICATE_WORKSPACE_HOOK");

  const collision = defineApp({ name: "Hook ID Collision", skills: [agent, child] }, ({ flow }) => {
    const value = flow.workspace({ id: hook.id, agent, skills: [child], hooks: [hook] });
    flow.output({ id: "collision_output", value });
  });
  await assert.rejects(() => compileApp(collision), (error) => error.code === "NODE_BUNDLE_ID_CONFLICT");
});

test("builds a v8 Runtime DAG with inferred fan-out, explicit joins, layout, and a portable plugin", async () => {
  const plugin = await pluginFixture();
  const userInput = variable.string("user_input");
  const approved = variable.boolean("approved", true);
  const writer = defineSkill({ id: "writer", name: "Writer", prompt: "Write {{skill_input}}", plugins: [plugin] });
  const reviewer = defineSkill({ id: "reviewer", name: "Reviewer", prompt: "Review {{skill_input}}" });
  const manager = defineSkill({ id: "manager", name: "Manager", category: "Agent", prompt: "Coordinate the work" });
  const app = defineApp({
    name: "SDK DAG",
    timeoutMs: 180_000,
    maxConcurrency: 4,
    variables: [userInput, approved],
    skills: [writer, reviewer, manager],
    visualizations: ["bar", "line"],
  }, ({ flow }) => {
    const form = flow.input({
      id: "collect",
      layout: "two-column",
      fields: [
        { variable: userInput, label: "Request", component: "input", size: "large" },
        { variable: approved, label: "Approved", component: "checkbox", size: "small" },
      ],
    });
    const draft = flow.skill({ id: "draft", skill: writer, input: userInput, output: "draft_text", after: form });
    const review = flow.skill({ id: "review", skill: reviewer, input: userInput, output: "review_text", after: form });
    const request = flow.http({
      id: "publish",
      method: "POST",
      url: "https://8.8.8.8/publish",
      body: { draft, review },
      after: [draft, review],
      output: "publish_response",
    });
    const final = flow.workspace({ id: "coordinate", agent: manager, skills: [writer, reviewer], input: request, after: request, output: "final_report", timeoutMs: 150_000 });
    flow.output({ id: "result", value: template`${final}`, output: "final_output" });
  });

  const compiled = await compileApp(app);
  assert.deepEqual(compiled.project.nodes.map((node) => node.type), ["START", "INPUT", "SKILL", "SKILL", "HTTP", "WORKSPACE", "OUTPUT"]);
  assert.equal(compiled.project.nodes.some((node) => node.type === "CONDITION"), false);
  assert.deepEqual(compiled.project.edges.map(({ from, to }) => `${from}->${to}`).sort(), [
    "collect->draft", "collect->review", "coordinate->result", "draft->publish", "publish->coordinate", "review->publish", "start->collect",
  ]);
  assert.ok(compiled.project.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.equal(compiled.project.plugins[0].runtime, "runtime");
  assert.match(compiled.project.plugins[0].integrity, /^sha256-/);
  assert.doesNotMatch(compiled.project.plugins[0].bundleCode, /@agcomm\/ai-sdk/);

  const bytes = await buildAi(app);
  const restored = await parseAiPackageV8(arrayBufferOf(bytes), "fallback");
  assert.equal(restored.formatVersion, 8);
  assert.equal(restored.name, "SDK DAG");
  assert.deepEqual(restored.visualizations, ["bar", "line"]);
  assert.deepEqual(restored.execution, { timeoutMs: 180_000, maxConcurrency: 4 });
  assert.equal(restored.nodes.find((node) => node.id === "coordinate").timeoutMs, 150_000);
  assert.deepEqual(restored.edges.map(({ from, to }) => `${from}->${to}`).sort(), compiled.project.edges.map(({ from, to }) => `${from}->${to}`).sort());
  assert.equal(restored.plugins[0].sourceCode.includes("definePlugin"), true);
});

test("ordinary TypeScript if and for statements determine the static graph at build time", async () => {
  const enabled = true;
  const app = defineApp({ name: "Static TS" }, ({ flow }) => {
    let previous;
    for (let index = 0; index < 3; index++) {
      if (enabled) previous = flow.http({ id: `request_${index}`, url: "https://8.8.8.8/data", after: previous ? [previous] : [] });
    }
    flow.output({ id: "result", value: previous, after: previous });
  });
  const compiled = await compileApp(app);
  assert.equal(compiled.project.nodes.filter((node) => node.type === "HTTP").length, 3);
  assert.equal(compiled.project.nodes.some((node) => node.type === "CONDITION"), false);
  assert.deepEqual(compiled.project.edges.map(({ from, to }) => `${from}->${to}`), [
    "start->request_0", "request_0->request_1", "request_1->request_2", "request_2->result",
  ]);
});

test("round-trips interaction capabilities and builds typed condition branches", async () => {
  const score = variable.number("score", 0);
  const app = defineApp({
    name: "Interactive condition",
    variables: [score],
    interaction: {
      conversation: { history: true, historyWindow: 12 },
      knowledge: { enabled: true, scopes: ["app", "session"], topK: 4 },
      streaming: { defaultMode: "events" },
    },
  }, ({ flow }) => {
    const input = flow.input({ id: "collect", fields: [{ variable: score, label: "Score" }] });
    const decision = flow.condition({ id: "decision", expression: template`${score} >= 0.7`, after: input, output: "accepted" });
    const high = flow.http({ id: "high", url: "https://8.8.8.8/high", after: decision.whenTrue() });
    const low = flow.http({ id: "low", url: "https://8.8.8.8/low", after: decision.whenFalse() });
    flow.output({ id: "result", value: { high, low }, after: [high, low] });
  });
  const compiled = await compileApp(app);
  assert.deepEqual(compiled.project.interaction, {
    conversation: { multiTurn: true, history: true, historyWindow: 12 },
    knowledge: { enabled: true, scopes: ["app", "session"], topK: 4, chunkSize: 1200, chunkOverlap: 200 },
    streaming: { defaultMode: "events" },
  });
  assert.deepEqual(compiled.project.edges.filter((edge) => edge.from === "decision").map((edge) => [edge.to, edge.condition]).sort(), [["high", "true"], ["low", "false"]]);
  assert.deepEqual(compiled.project.variables.filter((item) => ["session_id", "conversation_history", "knowledge_context"].includes(item.name)).map((item) => item.name).sort(), ["conversation_history", "knowledge_context", "session_id"]);
  const restored = await parseAiPackageV8(arrayBufferOf(await buildAi(app)), "interaction");
  assert.deepEqual(restored.interaction, compiled.project.interaction);
});

test("rejects invalid interaction combinations and duplicate condition consumers", () => {
  assert.throws(() => defineApp({ name: "Bad knowledge", interaction: { knowledge: { enabled: true, scopes: ["session"] } } }, ({ flow }) => flow.output({ id: "result" })), (error) => error instanceof AiSdkError && error.code === "SESSION_KNOWLEDGE_REQUIRES_HISTORY");
  assert.throws(() => defineApp({ name: "Bad stream", interaction: { streaming: { defaultMode: "tokens" } } }, ({ flow }) => flow.output({ id: "result" })), (error) => error instanceof AiSdkError && error.code === "INVALID_INTERACTION");
  assert.throws(() => defineApp({ name: "Reserved", variables: [variable.string("session_id")] }, ({ flow }) => flow.output({ id: "result" })), (error) => error instanceof AiSdkError && error.code === "RESERVED_VARIABLE");
  assert.throws(() => defineApp({ name: "Duplicate branch" }, ({ flow }) => {
    const decision = flow.condition({ id: "decision", expression: "true" });
    flow.http({ id: "first", url: "https://8.8.8.8/first", after: decision.whenTrue() });
    flow.http({ id: "second", url: "https://8.8.8.8/second", after: decision.whenTrue() });
    flow.output({ id: "result" });
  }), (error) => error instanceof AiSdkError && error.code === "DUPLICATE_BRANCH_CONSUMER");
});

test("round-trips background triggers and CONTACT nodes in v8", async () => {
  const app = defineApp({
    id: "daily_assistant",
    version: "1.0.0",
    name: "Daily Assistant",
    background: {
      historyWindow: 8,
      heartbeat: { id: "monitor", everyMs: 60_000, input: "check", variables: { source: "heartbeat" } },
      cron: [{ id: "morning", expression: "0 9 * * 1-5", timezone: "Asia/Shanghai", input: "report", variables: { source: "cron" } }],
    },
  }, ({ flow }) => {
    const source = flow.http({ id: "load_status", url: "https://8.8.8.8/status", after: [], output: "status" });
    const receipt = flow.contact({ id: "notify", title: "Action required", body: template`Review ${source}`, severity: "warning", webhook: true, dedupeKey: template`daily:${source}` });
    flow.output({ id: "result", value: receipt });
  });
  const compiled = await compileApp(app);
  assert.equal(compiled.project.appId, "daily_assistant");
  assert.equal(compiled.project.appVersion, "1.0.0");
  assert.equal(compiled.project.nodes.find((node) => node.id === "notify").type, "CONTACT");
  assert.ok(compiled.project.edges.some((edge) => edge.from === "load_status" && edge.to === "notify"));
  assert.deepEqual(compiled.project.variables.filter((item) => ["background_trigger", "gateway_run_id"].includes(item.name)).map((item) => item.name).sort(), ["background_trigger", "gateway_run_id"]);
  const restored = await parseAiPackageV8(arrayBufferOf(await buildAi(app)), "background");
  assert.equal(restored.background.heartbeat.everyMs, 60_000);
  assert.equal(restored.background.cron[0].timezone, "Asia/Shanghai");
  assert.equal(restored.nodes.find((node) => node.id === "notify").config.webhook, true);

  const files = await readZip(arrayBufferOf(await buildAi(app)));
  const flow = JSON.parse(files["flow/flow.json"]);
  flow.config.background = { historyWindow: 20 };
  files["flow/flow.json"] = JSON.stringify(flow);
  const invalidArchive = await createZip(files).arrayBuffer();
  await assert.rejects(() => parseAiPackageV8(invalidArchive, "invalid-background"), (error) => error.code === "REFERENCE_INVALID");

  let installed;
  const result = await installBackgroundApp(app, {
    gateway: {
      async install(path, options) {
        const project = await parseAiPackageV8(arrayBufferOf(await readFile(path)), "gateway-install");
        installed = { project, options };
        return { id: project.appId, version: project.appVersion };
      },
    },
    install: { enabled: false },
  });
  assert.deepEqual(result, { id: "daily_assistant", version: "1.0.0" });
  assert.equal(installed.project.formatVersion, 8);
  assert.deepEqual(installed.options, { enabled: false });
});

test("rejects invalid background declarations before packaging", () => {
  assert.throws(() => defineApp({ name: "Missing identity", background: { heartbeat: { id: "tick", everyMs: 60_000, input: "run" } } }, ({ flow }) => flow.output({ id: "result" })), (error) => error instanceof AiSdkError && error.code === "BACKGROUND_APP_ID_REQUIRED");
  assert.throws(() => defineApp({ id: "bad_cron", version: "1", name: "Bad cron", background: { cron: [{ id: "cron", expression: "not cron", timezone: "UTC", input: "run" }] } }, ({ flow }) => flow.output({ id: "result" })), (error) => error instanceof AiSdkError && error.code === "INVALID_CRON");
  assert.throws(() => defineApp({ name: "No background" }, ({ flow }) => { flow.contact({ id: "notify", title: "x", body: "y" }); flow.output({ id: "result" }); }), (error) => error instanceof AiSdkError && error.code === "CONTACT_REQUIRES_BACKGROUND");
  const topic = variable.string("topic");
  assert.throws(() => defineApp({ id: "missing_input", version: "1", name: "Missing input", variables: [topic], background: { heartbeat: { id: "tick", everyMs: 60_000, input: "run" } } }, ({ flow }) => {
    flow.input({ id: "input", fields: [{ variable: topic, label: "Topic" }] });
    flow.output({ id: "result" });
  }), (error) => error instanceof AiSdkError && error.code === "BACKGROUND_INPUT_REQUIRED");
});

test("reports builder and package failures before writing output", async () => {
  assert.throws(() => defineApp({ name: "Bad ID" }, ({ flow }) => flow.output({ id: "bad id" })), (error) => error instanceof AiSdkError && error.code === "INVALID_ID");
  assert.throws(() => defineApp({ name: "Async" }, async ({ flow }) => { flow.output({ id: "result" }); }), (error) => error instanceof AiSdkError && error.code === "ASYNC_BUILDER_UNSUPPORTED");
  const noOutput = defineApp({ name: "No output" }, ({ flow }) => { flow.http({ id: "request", url: "https://8.8.8.8" }); });
  await assert.rejects(() => compileApp(noOutput), (error) => error instanceof AiSdkError && error.code === "APP_INVALID");
  assert.throws(() => defineApp({ name: "Missing skill" }, ({ flow }) => {
    flow.skill({ id: "call", skill: defineSkill({ id: "missing", name: "Missing", prompt: "x" }) });
  }), (error) => error instanceof AiSdkError && error.code === "MISSING_SKILL");

  const plugin = definePlugin({ entry: "https://example.com/plugin.ts", id: "bad_plugin", name: "Bad", version: "1.0.0", tools: { run: defineTool({ description: "run", run() { return null; } }) } });
  const skill = defineSkill({ id: "skill", name: "Skill", prompt: "x", plugins: [plugin] });
  const invalidPlugin = defineApp({ name: "Invalid plugin", skills: [skill] }, ({ flow }) => {
    const result = flow.skill({ id: "call", skill });
    flow.output({ id: "result", value: result });
  });
  await assert.rejects(() => buildAi(invalidPlugin), (error) => error instanceof AiSdkError && error.code === "INVALID_PLUGIN_ENTRY");
});

test("writeAi creates directories and writes a round-trip-valid file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-sdk-output-"));
  const app = defineApp({ name: "Write" }, ({ flow }) => flow.output({ id: "result", value: "done" }));
  const target = join(directory, "nested", "write.ai");
  const result = await writeAi(app, target);
  const bytes = await readFile(target);
  assert.equal(result.path, target);
  assert.equal(result.byteLength, bytes.byteLength);
  assert.equal((await parseAiPackageV8(arrayBufferOf(bytes), "fallback")).name, "Write");
  await assert.rejects(() => parseAiPackage(arrayBufferOf(bytes), "fallback"), (error) => error?.code === "UNSUPPORTED_FORMAT_VERSION");
});

async function codeFixture() {
  const directory = await mkdtemp(join(tmpdir(), "ai-sdk-code-"));
  const entry = join(directory, "regex.code.ts");
  await writeFile(entry, `import { defineCode } from "@agcomm/ai-sdk/code";
export default defineCode({
  entry: import.meta.url,
  id: "regex_extract",
  name: "Regex Extract",
  description: "Extract regular expression matches",
  version: "1.0.0",
  inputSchema: { type: "object", properties: { text: { type: "string" }, pattern: { type: "string" } }, required: ["text", "pattern"], additionalProperties: false },
  outputSchema: { type: "object", properties: { matches: { type: "array", items: { type: "string" } } }, required: ["matches"], additionalProperties: false },
  permissions: [],
  run(input, context) { context.checkAborted(); return { matches: [...input.text.matchAll(new RegExp(input.pattern, "g"))].map((match) => match[0]) }; }
});
`, "utf8");
  return defineCode({
    entry: pathToFileURL(entry).href,
    id: "regex_extract",
    name: "Regex Extract",
    description: "Extract regular expression matches",
    version: "1.0.0",
    inputSchema: { type: "object", properties: { text: { type: "string" }, pattern: { type: "string" } }, required: ["text", "pattern"], additionalProperties: false },
    outputSchema: { type: "object", properties: { matches: { type: "array", items: { type: "string" } } }, required: ["matches"], additionalProperties: false },
    permissions: [],
    run(input, context) { context.checkAborted(); return { matches: [...String(input.text).matchAll(new RegExp(String(input.pattern), "g"))].map((match) => match[0]) }; },
  });
}

test("builds and directly executes typed CODE nodes without a model provider", async () => {
  const regex = await codeFixture();
  const input = variable.string("user_input");
  const app = defineApp({ name: "Code App", variables: [input] }, ({ flow }) => {
    const first = flow.code({ id: "extract_first", code: regex, input: { text: input, pattern: "[A-Z]+" }, output: "first_matches", after: [] });
    const second = flow.code({ id: "extract_second", code: regex, input: { text: input, pattern: "[0-9]+" }, output: "second_matches", after: first });
    flow.output({ id: "result", value: second });
  });
  const compiled = await compileApp(app);
  assert.equal(compiled.formatVersion, 8);
  assert.deepEqual(compiled.project.nodes.filter((node) => node.type === "CODE").map((node) => node.config.codeId), ["regex_extract", "regex_extract"]);
  assert.equal(compiled.project.plugins.filter((plugin) => plugin.id === "regex_extract").length, 1);
  const bytes = await buildAi(app);
  const files = await readZip(arrayBufferOf(bytes));
  assert.equal(JSON.parse(files["manifest.json"]).formatVersion, 8);
  assert.equal(JSON.parse(files["flow/nodes/extract_first.json"]).code_id, "regex_extract");
  await assert.rejects(() => runApp(app, { run: { input: "ABC 123" } }), (error) => error?.cause?.code === "PLUGIN_UNSIGNED");
  const result = await runApp(app, { runtime: { allowUnsignedPlugins: true }, run: { input: "ABC 123" } });
  assert.deepEqual(result.output, { matches: ["123"] });
});

test("rejects invalid CODE schemas, duplicate definitions, and Node-only imports before packaging", async () => {
  assert.throws(() => defineCode({
    entry: import.meta.url,
    id: "invalid_schema",
    name: "Invalid",
    description: "Invalid schema",
    version: "1.0.0",
    inputSchema: { type: "object", anyOf: [] },
    outputSchema: { type: "object" },
    run() { return {}; },
  }), /unsupported keyword anyOf/);
  assert.throws(() => defineCode({
    entry: import.meta.url,
    id: "invalid_output",
    name: "Invalid",
    description: "Invalid output",
    version: "1.0.0",
    inputSchema: { type: "object" },
    outputSchema: { type: ["string", "object"] },
    run() { return {}; },
  }), /exactly one non-null type/);

  const first = await codeFixture();
  const duplicate = defineCode({ ...first, run: first.run.bind(first) });
  assert.throws(() => defineApp({ name: "Duplicate Code" }, ({ flow }) => {
    flow.code({ id: "first", code: first, input: { text: "A", pattern: "A" } });
    flow.code({ id: "second", code: duplicate, input: { text: "B", pattern: "B" } });
    flow.output({ id: "result" });
  }), (error) => error instanceof AiSdkError && error.code === "DUPLICATE_CODE");

  const directory = await mkdtemp(join(tmpdir(), "ai-sdk-node-code-"));
  const entry = join(directory, "node-only.code.ts");
  await writeFile(entry, `import { readFile } from "node:fs/promises";
import { defineCode } from "@agcomm/ai-sdk/code";
export default defineCode({ entry: import.meta.url, id: "node_only", name: "Node Only", description: "Invalid Node dependency", version: "1.0.0", inputSchema: { type: "object" }, outputSchema: { type: "string" }, async run() { return readFile("x", "utf8"); } });`, "utf8");
  const nodeOnly = defineCode({
    entry: pathToFileURL(entry).href,
    id: "node_only",
    name: "Node Only",
    description: "Invalid Node dependency",
    version: "1.0.0",
    inputSchema: { type: "object" },
    outputSchema: { type: "string" },
    run() { return ""; },
  });
  const app = defineApp({ name: "Node Only" }, ({ flow }) => {
    const value = flow.code({ id: "call", code: nodeOnly, input: {} });
    flow.output({ id: "result", value });
  });
  await assert.rejects(() => buildAi(app), (error) => error instanceof AiSdkError && error.code === "CODE_BUILD_FAILED");
});

test("runApp and createAppRunner execute the packaged application through ai-runtime", async () => {
  const input = variable.string("user_input");
  const app = defineApp({ name: "Runner", variables: [input] }, ({ flow }) => flow.output({ id: "result", value: template`value:${input}` }));
  assert.equal((await runApp(app, { run: { input: "one" } })).output, "value:one");
  const oneShotStream = await streamApp(app, { run: { mode: "text", input: "stream-one" } });
  const oneShotChunks = [];
  for await (const chunk of oneShotStream) oneShotChunks.push(chunk);
  assert.deepEqual(oneShotChunks, ["value:stream-one"]);
  assert.equal((await oneShotStream.result).output, "value:stream-one");
  const runner = await createAppRunner(app);
  try {
    assert.equal((await runner.run({ input: "two" })).output, "value:two");
    assert.equal((await runner.run({ input: "three" })).output, "value:three");
    const events = runner.stream({ mode: "events", input: "stream-two" });
    const eventTypes = [];
    for await (const event of events) eventTypes.push(event.type);
    assert.equal((await events.result).output, "value:stream-two");
    assert.equal(eventTypes[0], "run-start");
    assert.equal(eventTypes.at(-1), "result");
    assert.deepEqual(await runner.listSessions(), []);
  } finally { await runner.dispose(); }
  await assert.rejects(() => runner.run(), /disposed/);
  await assert.rejects(() => runner.listSessions(), /disposed/);
});

function toolProvider() {
  return {
    model: "fake",
    async call({ messages, tools }) {
      if (tools.length && messages.length === 2) return { content: "", toolCalls: [{ id: "call-1", name: tools[0].function.name, args: { text: " hello " } }] };
      return { content: "done", toolCalls: [] };
    },
  };
}

test("unsigned SDK plugins require explicit runtime opt-in and still enforce integrity", async () => {
  const plugin = await pluginFixture();
  const skill = defineSkill({ id: "tool_skill", name: "Tool Skill", prompt: "Use tools", plugins: [plugin] });
  const app = defineApp({ name: "Unsigned", skills: [skill] }, ({ flow }) => {
    const answer = flow.skill({ id: "call", skill, input: "normalize", output: "answer" });
    flow.output({ id: "result", value: answer });
  });
  await assert.rejects(() => runApp(app, { runtime: { provider: toolProvider() } }), (error) => error?.cause?.code === "PLUGIN_UNSIGNED");
  const result = await runApp(app, { runtime: { provider: toolProvider(), allowUnsignedPlugins: true } });
  assert.equal(result.output, "done");
  assert.equal(result.toolCalls.length, 1);

  const bytes = await buildAi(app);
  const files = await readZip(arrayBufferOf(bytes));
  files["plugins/text_tools/dist/index.js"] += "\n// tampered";
  const tampered = new Uint8Array(await createZip(files).arrayBuffer());
  const runtimeModule = await import("../../ai-runtime/dist/index.js");
  const runtime = runtimeModule.createRuntime({ provider: toolProvider(), allowUnsignedPlugins: true });
  try { await assert.rejects(() => runtime.runAiFile(tampered), (error) => error?.cause?.code === "PLUGIN_INTEGRITY_INVALID"); }
  finally { await runtime.dispose(); }
});
