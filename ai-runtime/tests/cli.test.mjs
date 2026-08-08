import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { createAiPackage } from "../../../lib/ai-package.ts";
import { childProcessTracker, installActiveHandleDiagnostics } from "../../test-utils/active-handles.mjs";

const childProcesses = childProcessTracker();
const execute = (file, args, options = {}) => new Promise((resolveExecute, rejectExecute) => {
  const child = childProcesses.add(execFile(file, args, options, (error, stdout, stderr) => {
    if (error) {
      error.stdout = stdout;
      error.stderr = stderr;
      rejectExecute(error);
    } else resolveExecute({ stdout, stderr });
  }));
  child.once("error", () => {
    // execFile's callback owns rejection; this listener documents and tracks the handle lifecycle.
  });
});
after(() => childProcesses.dispose());
installActiveHandleDiagnostics("ai-runtime/cli");
const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const gatewayRoot = resolve(packageRoot, "../gateway");
const cli = resolve(packageRoot, "dist/cli.js");
const fixture = resolve(packageRoot, "../../test-fixtures/ai/01-basic-input-output.ai");
const skillFixture = resolve(packageRoot, "../../test-fixtures/ai/02-skill-call.ai");
const packageVersion = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")).version;

test("CLI reports the Runtime package version", async () => {
  const { stdout, stderr } = await execute(process.execPath, [cli, "--version"]);
  assert.equal(stderr, "");
  assert.equal(stdout, `${packageVersion}\n`);
});

test("CLI emits exactly one success JSON document", async () => {
  const { stdout, stderr } = await execute(process.execPath, [cli, fixture, "--input", "cli-value", "--vars", '{"extra":true}']);
  assert.equal(stderr, "");
  assert.equal(stdout.trim().split("\n").length, 1);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "completed");
  assert.match(String(payload.output), /cli-value/);
  assert.equal(payload.variables.extra, true);
});

test("CLI accepts explicit headless and JSON modes", async () => {
  const { stdout, stderr } = await execute(process.execPath, [cli, fixture, "--headless", "--json", "--input", "headless-value"]);
  assert.equal(stderr, "");
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.match(String(payload.output), /headless-value/);
});

test("CLI --stream writes only final text chunks to stdout", async () => {
  const { stdout, stderr } = await execute(process.execPath, [cli, fixture, "--stream", "--input", "stream-value"]);
  assert.equal(stderr, "");
  assert.match(stdout, /stream-value/);
  assert.ok(stdout.endsWith("\n"));
  assert.throws(() => JSON.parse(stdout));
  await assert.rejects(
    execute(process.execPath, [cli, fixture, "--stream", "--json"]),
    (error) => {
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /INVALID_ARGUMENTS/);
      return true;
    },
  );
});

test("CLI accepts batch mode and rejects conflicting interaction modes", async () => {
  const { stdout, stderr } = await execute(process.execPath, [cli, fixture, "--batch", "--input", "batch-value"]);
  assert.equal(stderr, "");
  assert.match(String(JSON.parse(stdout).output), /batch-value/);
  await assert.rejects(
    execute(process.execPath, [cli, fixture, "--headless", "--batch"]),
    (error) => {
      const payload = JSON.parse(error.stdout);
      assert.equal(payload.error.code, "INVALID_ARGUMENTS");
      return true;
    },
  );
});

test("agcomm open requires a full interactive terminal", async () => {
  await assert.rejects(
    execute(process.execPath, [cli, "open"]),
    (error) => JSON.parse(error.stdout).error.code === "INTERACTIVE_TERMINAL_REQUIRED",
  );
  await assert.rejects(
    execute(process.execPath, [cli, "open", fixture]),
    (error) => JSON.parse(error.stdout).error.code === "INVALID_ARGUMENTS",
  );
});

test("CLI requires an explicit flag and emits a warning when unsigned plugins are allowed", async () => {
  const { stdout, stderr } = await execute(process.execPath, [cli, fixture, "--batch", "--allow-unsigned-plugins", "--input", "trusted-local-file"]);
  assert.match(stderr, /unsigned plugins are allowed/i);
  assert.match(String(JSON.parse(stdout).output), /trusted-local-file/);
});

test("non-interactive headless mode rejects an INPUT button group without a selected value", async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), "ai-runtime-headless-input-"));
  const project = {
    name: "Headless input validation",
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "input", title: "Choose", type: "INPUT", icon: "", x: 100, y: 0, tone: "", note: "", outputVar: "values", config: {
        layout: "single",
        fields: [{ id: "go", variable: "action", label: "Go", component: "button", size: "small", buttonValue: "go" }],
      } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output", config: { template: "{{action}}" } },
    ],
    edges: [{ from: "start", to: "input" }, { from: "input", to: "output" }],
    skills: [], plugins: [], visualizations: [],
    variables: [
      { name: "action", type: "string", defaultValue: "none" },
      { name: "values", type: "object", defaultValue: "{}" },
      { name: "final_output", type: "markdown", defaultValue: "" },
    ],
  };
  const file = resolve(temporary, "button.ai");
  await writeFile(file, new Uint8Array(await createAiPackage(project).arrayBuffer()));
  await assert.rejects(
    execute(process.execPath, [cli, file, "--headless"]),
    (error) => {
      assert.equal(error.stderr, "");
      assert.equal(JSON.parse(error.stdout).error.code, "INPUT_VALUES_REQUIRED");
      return true;
    },
  );
  const { stdout } = await execute(process.execPath, [cli, file, "--batch"]);
  assert.equal(JSON.parse(stdout).ok, true);
});

test("CLI emits stable JSON errors and does not expose an API key", async () => {
  const secret = "sk-proj-super-secret-value-123456";
  await assert.rejects(
    execute(process.execPath, [cli, "missing.ai"], { env: { ...process.env, OPENAI_API_KEY: secret } }),
    (error) => {
      const payload = JSON.parse(error.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.error.code, "FILE_NOT_FOUND");
      assert.doesNotMatch(error.stdout + error.stderr, new RegExp(secret));
      return true;
    },
  );
});

test("CLI selects a named HTTP model connection and redacts referenced authentication secrets", async () => {
  const secret = "vendor-secret-token-123456";
  const connection = {
    vendor: {
      url: "https://8.8.8.8/model",
      method: "POST",
      model: "vendor-model",
      auth: { type: "bearer", tokenEnv: "VENDOR_TOKEN" },
      requestTransformer: "() => { throw new Error(process.env.VENDOR_TOKEN); }",
      response: { mode: "json", contentPointer: "/content" },
    },
  };
  await assert.rejects(
    execute(process.execPath, [cli, skillFixture, "--input", "hello"], { env: {
      ...process.env,
      AI_MODEL_CONNECTION: "vendor",
      AI_HTTP_CONNECTIONS: JSON.stringify(connection),
      VENDOR_TOKEN: secret,
    } }),
    (error) => {
      const payload = JSON.parse(error.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.error.code, "HTTP_TRANSFORM_FAILED");
      assert.doesNotMatch(error.stdout + error.stderr, new RegExp(secret));
      return true;
    },
  );
});

test("CLI reports a missing named HTTP model connection before execution", async () => {
  await assert.rejects(
    execute(process.execPath, [cli, fixture], { env: { ...process.env, AI_MODEL_CONNECTION: "missing", AI_HTTP_CONNECTIONS: "{}" } }),
    (error) => {
      const payload = JSON.parse(error.stdout);
      assert.equal(payload.error.code, "HTTP_CONNECTION_NOT_FOUND");
      return true;
    },
  );
});

test("SIGINT aborts the active flow and exits with 130", async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), "ai-runtime-sigint-"));
  const project = {
    name: "SIGINT",
    nodes: [
      { id: "start", title: "Start", type: "START", icon: "", x: 0, y: 0, tone: "", note: "", outputVar: "" },
      { id: "http", title: "HTTP", type: "HTTP", icon: "", x: 100, y: 0, tone: "", note: "", outputVar: "response", config: { method: "GET", url: "http://127.0.0.1/private" } },
      { id: "output", title: "Output", type: "OUTPUT", icon: "", x: 200, y: 0, tone: "", note: "", outputVar: "final_output" },
    ],
    edges: [{ from: "start", to: "http" }, { from: "http", to: "output" }],
    skills: [], plugins: [], visualizations: [],
    variables: [{ name: "response", type: "object", defaultValue: "{}" }, { name: "final_output", type: "markdown", defaultValue: "" }],
  };
  const file = resolve(temporary, "interrupt.ai");
  await writeFile(file, new Uint8Array(await createAiPackage(project).arrayBuffer()));
  const child = childProcesses.add(spawn(process.execPath, [cli, file], { stdio: ["ignore", "pipe", "pipe"] }));
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  await new Promise((resolve) => setTimeout(resolve, 150));
  child.kill("SIGINT");
  const [code] = await once(child, "close");
  assert.equal(code, 130);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "CANCELLED");
});

test("packed Runtime and Gateway preserve package and license boundaries", { timeout: 90_000 }, async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), "ai-runtime-pack-"));
  const env = { ...process.env, npm_config_cache: resolve(temporary, ".npm-cache") };
  const packed = JSON.parse((await execute("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: packageRoot, env, timeout: 90_000 })).stdout);
  const runtimeManifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  assert.equal(runtimeManifest.license, "LGPL-3.0-only");
  assert.equal(runtimeManifest.dependencies["@agcomm/gateway"], "^0.8.0");
  assert.ok(packed[0].files.some(({ path }) => path === "LICENSE"));
  assert.ok(!packed[0].files.some(({ path }) => path.startsWith("dist/packages/gateway/")));
  assert.ok(!packed[0].files.some(({ path }) => path === "GATEWAY-LICENSE"));
  const packedGateway = JSON.parse((await execute("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: gatewayRoot, env, timeout: 90_000 })).stdout);
  const gatewayManifest = JSON.parse(await readFile(resolve(gatewayRoot, "package.json"), "utf8"));
  assert.equal(gatewayManifest.license, "Elastic-2.0");
  assert.equal(gatewayManifest.peerDependencies["@agcomm/ai-runtime"], "^0.8.0");
  assert.ok(packedGateway[0].files.some(({ path }) => path === "LICENSE"));
  assert.ok(!packedGateway[0].files.some(({ path }) => path.startsWith("dist/packages/ai-runtime/")));
  assert.ok(packed[0].files.some(({ path }) => path === "dist/cli.js"));
  assert.ok(packedGateway[0].files.some(({ path }) => path === "dist/index.js"));
  assert.match(await readFile(resolve(packageRoot, "dist/index.js"), "utf8"), /chunks\//);
});
