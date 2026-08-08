import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installActiveHandleDiagnostics } from "../../test-utils/active-handles.mjs";
import { confirmTerminalGateway, LocalRuntimeConfigStore, runTerminalApp, runTerminalLauncher } from "../dist/index.js";

installActiveHandleDiagnostics("ai-runtime/terminal-app");

function terminals() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 100;
  output.rows = 30;
  let screen = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => { screen += chunk; });
  return { input, output, screen: () => screen };
}

async function waitFor(terminal, pattern) {
  for (let index = 0; index < 100; index++) {
    if (pattern.test(terminal.screen().split("\u001b[H\u001b[2J").at(-1) ?? "")) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.match(terminal.screen(), pattern);
}

function memorySession() {
  const messages = [];
  return {
    id: "session-1",
    title: "Temporary",
    async history() { return messages; },
    async runTurn(input) { messages.push({ role: "user", content: input, createdAt: "now" }, { role: "assistant", content: "done", createdAt: "now" }); return { ok: true }; },
    async rename() {},
    async dispose() {},
  };
}

test("terminal app opens an in-memory conversation and restores terminal state", async () => {
  const terminal = terminals();
  const session = memorySession();
  const app = {
    id: "app", name: "Conversation App", interaction: { conversation: { multiTurn: true } },
    async createSession() { return session; },
  };
  const running = runTerminalApp(app, { input: terminal.input, output: terminal.output });
  await waitFor(terminal, /Enter 输入/);
  terminal.input.write("\r");
  await waitFor(terminal, /输入消息/);
  terminal.input.write("\u001b");
  await waitFor(terminal, /Enter 输入/);
  terminal.input.write("q");
  await running;
  assert.equal(terminal.input.isRaw, false);
  assert.match(terminal.screen(), /输入消息/);
  assert.equal(terminal.screen().includes("\u001b[?1049l"), true);
});

test("terminal knowledge manager browses and imports files with an explicit scope", async () => {
  const previous = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "ai-tui-files-"));
  const file = join(directory, "notes.md");
  await writeFile(file, "notes");
  process.chdir(directory);
  try {
    const terminal = terminals();
    const session = memorySession();
    const imported = [];
    const app = {
      id: "app", name: "Knowledge App", interaction: { conversation: { multiTurn: true }, knowledge: { enabled: true, scopes: ["app"] } },
      async createSession() { return session; },
      async listKnowledge() { return []; },
      async importKnowledge(paths, options) { imported.push({ paths, options }); return paths.map((path) => ({ name: path })); },
      async removeKnowledge() {},
    };
    const running = runTerminalApp(app, { input: terminal.input, output: terminal.output });
    await waitFor(terminal, /K 知识库/);
    terminal.input.write("k");
    await waitFor(terminal, /U 上传/);
    terminal.input.write("u");
    await waitFor(terminal, /notes\.md/);
    terminal.input.write("\u001b[B");
    await waitFor(terminal, /› ○ notes\.md/);
    terminal.input.emit("keypress", " ", { name: "space", sequence: " ", ctrl: false, meta: false, shift: false });
    await waitFor(terminal, /U 导入 \(1\)/);
    terminal.input.write("u");
    await waitFor(terminal, /已索引 1 个文件/);
    terminal.input.write("q");
    await waitFor(terminal, /K 知识库/);
    terminal.input.write("q");
    await running;
    assert.equal(imported.length, 1);
    assert.equal(imported[0].paths.length, 1);
    assert.equal(imported[0].paths[0].endsWith("/notes.md"), true);
    assert.deepEqual(imported[0].options.scope, { type: "app" });
  } finally { process.chdir(previous); }
});

test("terminal launcher opens a selected .ai file without a desktop picker", async () => {
  const previous = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "ai-runtime-launcher-"));
  const file = join(directory, "app.ai");
  await writeFile(file, "fixture");
  process.chdir(directory);
  try {
    const terminal = terminals();
    const credentials = { async get() {}, async set() {}, async delete() {} };
    const store = new LocalRuntimeConfigStore({ root: join(directory, "config"), credentialStore: credentials });
    const running = runTerminalLauncher(store, { input: terminal.input, output: terminal.output });
    await waitFor(terminal, /打开 \.ai/);
    terminal.input.write("\r");
    await waitFor(terminal, /app\.ai/);
    terminal.input.emit("keypress", undefined, { name: "down", sequence: "\u001b[B", ctrl: false, meta: false, shift: false });
    await waitFor(terminal, /›\s+app\.ai/);
    terminal.input.emit("keypress", "\r", { name: "return", sequence: "\r", ctrl: false, meta: false, shift: false });
    assert.equal(await realpath(await running), await realpath(file));
    assert.equal(terminal.input.isRaw, false);
  } finally { process.chdir(previous); }
});

function backgroundInfo() {
  return {
    formatVersion: 5,
    packageHash: "a".repeat(64),
    nodes: [{ id: "notify", title: "Notify", type: "CONTACT" }],
    bundles: [{ id: "code", name: "Code", version: "1", kind: "code", runtime: "runtime", permissions: ["clipboard:read"], signed: false }],
    background: {
      appId: "daily_assistant", version: "1.0.0", triggerCount: 1, contactCount: 1, requiresWebhook: false,
      triggers: [{ id: "monitor", type: "heartbeat", schedule: "every 60000ms" }],
    },
  };
}

test("terminal Gateway confirmation disables on rejection without installing a service", async () => {
  const terminal = terminals();
  const calls = [];
  const gateway = {
    async listApps() { return [{ id: "daily_assistant" }]; },
    async disable(id) { calls.push(["disable", id]); },
  };
  let installedService = false;
  const pending = confirmTerminalGateway(backgroundInfo(), "/tmp/app.ai", {
    input: terminal.input, output: terminal.output, gateway,
    installService: async () => { installedService = true; },
  });
  await waitFor(terminal, /启用 Runtime Gateway/);
  terminal.input.write("n");
  assert.equal(await pending, false);
  assert.equal(installedService, false);
  assert.deepEqual(calls, [["disable", "daily_assistant"]]);
});

test("terminal Gateway confirmation preflights before installation", async () => {
  const terminal = terminals();
  const calls = [];
  const gateway = {
    async listApps() { return []; },
    async install(path, options) { calls.push(["install", path, options]); },
  };
  const pending = confirmTerminalGateway(backgroundInfo(), "/tmp/app.ai", {
    input: terminal.input, output: terminal.output, gateway,
    preflight: async () => { calls.push(["preflight"]); },
  });
  await waitFor(terminal, /Heartbeat monitor/);
  terminal.input.write("y");
  assert.equal(await pending, true);
  assert.deepEqual(calls, [["preflight"], ["install", "/tmp/app.ai", { enabled: true }]]);
});
