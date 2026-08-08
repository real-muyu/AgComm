import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installActiveHandleDiagnostics } from "../../test-utils/active-handles.mjs";
import { connectRuntimeGateway, createRuntimeGateway } from "../dist/index.js";
import { createRuntime } from "../../ai-runtime/dist/index.js";
import { createAiPackageV5 } from "../../../lib/ai-package-v5-format.ts";
import { createAiPackageV6 } from "../../../lib/ai-package-v6-format.ts";
import { createAiPackageV7 } from "../../../lib/ai-package-v7-format.ts";
import { createAiPackageBeta1 } from "../../../lib/ai-package-beta-one-format.ts";

installActiveHandleDiagnostics("gateway/runtime");

function backgroundProject({ webhook = false, body = "Review task", streamMode } = {}) {
  return {
    appId: "daily_assistant",
    appVersion: "1.0.0",
    name: "Daily Assistant",
    background: {
      historyWindow: 20,
      heartbeat: { id: "monitor", everyMs: 60_000, input: "check", variables: { source: "heartbeat" }, runOnStart: false },
    },
    ...(streamMode ? { interaction: { streaming: { defaultMode: streamMode } } } : {}),
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "", config: {} },
      { id: "notify", title: "Notify", type: "CONTACT", icon: "", x: 100, y: 0, tone: "", note: "", outputVar: "contact_receipt", config: { title: "Action required", body, severity: "warning", webhook, dedupeKey: "task:daily" } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "{{contact_receipt}}" } },
    ],
    edges: [{ from: "start", to: "notify" }, { from: "notify", to: "output" }],
    skills: [],
    plugins: [],
    visualizations: [],
    variables: [
      { name: "background_trigger", type: "object", defaultValue: "{}" },
      { name: "gateway_run_id", type: "string", defaultValue: "" },
      { name: "contact_receipt", type: "object", defaultValue: "{}" },
      { name: "final_output", type: "markdown", defaultValue: "" },
    ],
  };
}

async function packageBytes(options) {
  return new Uint8Array(await createAiPackageV5(backgroundProject(options), "2026-07-30T00:00:00.000Z").arrayBuffer());
}

async function packageBytesV6(options) {
  return new Uint8Array(await createAiPackageV6(backgroundProject(options), "2026-07-30T00:00:00.000Z").arrayBuffer());
}

async function packageBytesV7(options) {
  return new Uint8Array(await createAiPackageV7(backgroundProject(options), "2026-07-30T00:00:00.000Z").arrayBuffer());
}

async function packageBytesBeta1(options) {
  return new Uint8Array(await createAiPackageBeta1(backgroundProject(options), "2026-08-03T00:00:00.000Z").arrayBuffer());
}

async function slowPackageBytesV7() {
  const project = backgroundProject({ streamMode: "events" });
  project.nodes = [
    project.nodes[0],
    { id: "work", title: "Work", type: "SKILL", icon: "", x: 100, y: 0, tone: "", note: "worker", outputVar: "answer", config: { skillId: "worker", input: "{{user_input}}" } },
    { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "{{answer}}" } },
  ];
  project.edges = [{ from: "start", to: "work" }, { from: "work", to: "output" }];
  project.skills = [{ id: "worker", name: "Worker", description: "Wait for cancellation", category: "test", prompt: "Wait", pluginIds: [] }];
  project.variables.push(
    { name: "user_input", type: "string", defaultValue: "" },
    { name: "answer", type: "markdown", defaultValue: "" },
  );
  return new Uint8Array(await createAiPackageV7(project, "2026-07-30T00:00:00.000Z").arrayBuffer());
}

function memoryCredentials() {
  const values = new Map();
  return {
    async get(id) { return values.get(id); },
    async set(id, value) { values.set(id, value); },
    async delete(id) { values.delete(id); },
  };
}

function hasCode(error, code) {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth++) {
    if (current.code === code) return true;
    current = current.cause;
  }
  return false;
}

test("CONTACT requires a Gateway background execution context", async () => {
  const runtime = createRuntime();
  const bytes = await packageBytes();
  try {
    await assert.rejects(() => runtime.runAiFile(bytes), (error) => hasCode(error, "CONTACT_REQUIRES_GATEWAY"));
  } finally { await runtime.dispose(); }
});

test("Gateway installs a v5 app and records background runs and Inbox contacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-"));
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials() });
  await gateway.initialize();
  const installed = await gateway.install(await packageBytes(), { enabled: true });
  assert.equal(installed.id, "daily_assistant");
  await gateway.runNow(installed.id, "monitor");
  const runs = await gateway.listRuns(installed.id);
  const inbox = await gateway.listInbox(installed.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "completed");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].title, "Action required");
  assert.equal(inbox[0].deliveryStatus, "none");
  await gateway.markInboxRead(installed.id, [inbox[0].id]);
  assert.ok((await gateway.listInbox(installed.id))[0].readAt);
  await gateway.dispose();
});

test("Gateway installs and executes a v6 background app", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-v6-"));
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials() });
  await gateway.initialize();
  const installed = await gateway.install(await packageBytesV6(), { enabled: true });
  await gateway.runNow(installed.id, "monitor");
  assert.equal((await gateway.listRuns(installed.id))[0].status, "completed");
  assert.equal((await gateway.listInbox(installed.id))[0].title, "Action required");
  await gateway.dispose();
});

test("Gateway installs and executes a Beta 1 background app", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-beta-one-"));
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials() });
  await gateway.initialize();
  const installed = await gateway.install(await packageBytesBeta1(), { enabled: true });
  await gateway.runNow(installed.id, "monitor");
  assert.equal((await gateway.listRuns(installed.id))[0].status, "completed");
  assert.equal((await gateway.listInbox(installed.id))[0].title, "Action required");
  await gateway.dispose();
});

test("Gateway persists v7 event streams, derives text, and resumes after sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-v7-stream-"));
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials() });
  await gateway.initialize();
  const installed = await gateway.install(await packageBytesV7({ streamMode: "events" }), { enabled: true });
  assert.equal(installed.defaultStreamMode, "events");

  const ticket = await gateway.startRunNow(installed.id, "monitor");
  const events = await gateway.watchRun(installed.id, ticket.runId);
  const frames = [];
  for await (const frame of events) frames.push(frame);
  const record = await events.completion;
  assert.equal(record.status, "completed");
  assert.equal(record.streamMode, "events");
  assert.equal(record.lastSequence, frames.at(-1).sequence);
  assert.deepEqual(frames.map((frame) => frame.sequence), frames.map((_, index) => index + 1));
  assert.ok(frames.some((frame) => frame.value.type === "output-delta"));
  assert.equal(frames.at(-1).value.type, "result");

  const resumed = await gateway.watchRun(installed.id, ticket.runId, {
    mode: "events",
    afterSequence: frames[0].sequence,
  });
  const resumedFrames = [];
  for await (const frame of resumed) resumedFrames.push(frame);
  assert.deepEqual(resumedFrames, frames.slice(1));

  const text = await gateway.watchRun(installed.id, ticket.runId, { mode: "text" });
  let output = "";
  for await (const frame of text) output += frame.value;
  assert.match(output, /"status":"queued"/);
  await gateway.dispose();
});

test("Gateway cannot upgrade a persisted text run to full events", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-text-stream-"));
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials() });
  await gateway.initialize();
  const installed = await gateway.install(await packageBytesV7({ streamMode: "text" }), { enabled: true });
  const ticket = await gateway.startRunNow(installed.id, "monitor");
  const text = await gateway.watchRun(installed.id, ticket.runId);
  for await (const _frame of text) { /* Consume the run. */ }
  await assert.rejects(
    () => gateway.watchRun(installed.id, ticket.runId, { mode: "events" }),
    (error) => error.code === "GATEWAY_STREAM_MODE_UNAVAILABLE",
  );
  await gateway.dispose();
});

test("Gateway coalesces overlapping triggers and disable cancels active and queued runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-coalesce-"));
  const provider = {
    model: "gateway-slow-fake",
    async call({ onEvent, signal }) {
      onEvent?.({ type: "token", text: "started" });
      await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      return { content: "unreachable" };
    },
  };
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials(), runtime: { provider } });
  await gateway.initialize();
  const installed = await gateway.install(await slowPackageBytesV7(), { enabled: true });
  const active = await gateway.startRunNow(installed.id, "monitor");
  const queued = await gateway.startRunNow(installed.id, "monitor");
  const coalesced = await gateway.startRunNow(installed.id, "monitor");
  assert.equal(active.status, "running");
  assert.equal(queued.status, "queued");
  assert.equal(coalesced.coalesced, true);
  assert.equal(coalesced.runId, queued.runId);
  await gateway.disable(installed.id);
  const records = await gateway.listRuns(installed.id);
  assert.deepEqual(records.map((record) => record.status), ["cancelled", "cancelled"]);
  await gateway.dispose();
});

test("Gateway cancels runs whose persisted stream exceeds 4 MiB", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-stream-limit-"));
  const provider = {
    model: "gateway-large-stream-fake",
    async call({ onEvent }) {
      const content = "x".repeat(4 * 1_048_576 + 1);
      onEvent?.({ type: "token", text: content });
      return { content };
    },
  };
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials(), runtime: { provider } });
  await gateway.initialize();
  const installed = await gateway.install(await slowPackageBytesV7(), { enabled: true });
  await gateway.runNow(installed.id, "monitor");
  const record = (await gateway.listRuns(installed.id))[0];
  assert.equal(record.status, "failed");
  assert.match(record.error, /4 MiB/);
  const stream = await gateway.watchRun(installed.id, record.id);
  for await (const _frame of stream) { /* Retained prefix remains readable. */ }
  await gateway.dispose();
});

test("Gateway signs Webhook deliveries", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-ipc-"));
  const secret = "test-webhook-secret-1234";
  const requests = [];
  const gateway = createRuntimeGateway({
    root,
    credentialStore: memoryCredentials(),
    fetcher: async (url, init) => { requests.push({ url: String(url), init }); return new Response("ok", { status: 200 }); },
  });
  await gateway.initialize();
  const bytes = await packageBytes({ webhook: true });
  const app = await gateway.install(bytes, { enabled: true, webhook: { url: "https://8.8.8.8/hook", secret } });
  await gateway.runNow(app.id, "monitor");
  await gateway.tick();
  assert.equal(requests.length, 1);
  const body = String(requests[0].init.body);
  const headers = new Headers(requests[0].init.headers);
  const timestamp = headers.get("x-agcomm-timestamp");
  assert.equal(headers.get("x-agcomm-signature"), `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`);
  assert.equal((await gateway.listInbox(app.id))[0].deliveryStatus, "delivered");
  await gateway.dispose();
});

test("Gateway rejects private and credential-bearing Webhook URLs before installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-webhook-"));
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials() });
  await gateway.initialize();
  const bytes = await packageBytes({ webhook: true });
  await assert.rejects(() => gateway.install(bytes, { webhook: { url: "https://127.0.0.1/hook", secret: "test-webhook-secret-1234" } }), (error) => error.code === "GATEWAY_WEBHOOK_INVALID");
  await assert.rejects(() => gateway.install(bytes, { webhook: { url: "https://8.8.8.8/hook?token=secret", secret: "test-webhook-secret-1234" } }), (error) => error.code === "GATEWAY_WEBHOOK_INVALID");
  assert.deepEqual(await gateway.listApps(), []);
  await gateway.dispose();
});

test("Gateway rejects rendered CONTACT bodies over 64 KiB without writing Inbox", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-contact-limit-"));
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials() });
  await gateway.initialize();
  const app = await gateway.install(await packageBytes({ body: "界".repeat(30_000) }));
  await gateway.runNow(app.id, "monitor");
  assert.equal((await gateway.listRuns(app.id))[0].status, "failed");
  assert.match((await gateway.listRuns(app.id))[0].error, /64 KiB/);
  assert.deepEqual(await gateway.listInbox(app.id), []);
  await gateway.dispose();
});

test("Gateway exposes authenticated local IPC", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-gateway-ipc-"));
  const gateway = createRuntimeGateway({ root, credentialStore: memoryCredentials() });
  try {
    await gateway.start();
  } catch (error) {
    if (error?.code === "EPERM") { context.skip("Unix sockets are disabled by the test sandbox"); return; }
    throw error;
  }
  try {
    const client = await connectRuntimeGateway({ root });
    assert.equal((await client.ping()).alive, true);
    await client.install(join(root, "missing.ai")).catch((error) => assert.equal(error.code, "GATEWAY_REQUEST_FAILED"));
    const path = join(root, "streaming.ai");
    await writeFile(path, await packageBytesV7({ streamMode: "events" }));
    const app = await client.install(path);
    const ticket = await client.startRunNow(app.id, "monitor");
    const stream = await client.watchRun(app.id, ticket.runId, { mode: "text" });
    let output = "";
    for await (const frame of stream) output += frame.value;
    assert.equal((await stream.completion).status, "completed");
    assert.match(output, /"status":"queued"/);
  } finally { await gateway.dispose(); }
});
