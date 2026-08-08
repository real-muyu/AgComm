import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installActiveHandleDiagnostics } from "../../test-utils/active-handles.mjs";
import { installGatewayAutostart } from "../dist/index.js";

installActiveHandleDiagnostics("gateway/service");

async function fixture(platform) {
  const homeDir = await mkdtemp(join(tmpdir(), `gateway-service-${platform}-`));
  const calls = [];
  const result = await installGatewayAutostart({
    platform,
    homeDir,
    nodePath: "/stable/node",
    cliPath: "/stable/agcomm.js",
    execute: async (file, args) => { calls.push([file, [...args]]); },
  });
  return { homeDir, calls, result };
}

test("installs a current-user macOS LaunchAgent", async () => {
  const { calls, result } = await fixture("darwin");
  const plist = await readFile(result.path, "utf8");
  assert.match(plist, /io\.agcomm\.runtime\.gateway/);
  assert.match(plist, /<string>gateway<\/string><string>run<\/string>/);
  assert.deepEqual(calls.map(([file, args]) => [file, args[0]]), [["launchctl", "bootout"], ["launchctl", "bootstrap"]]);
});

test("installs a limited current-user Windows login task", async () => {
  const { calls } = await fixture("win32");
  assert.equal(calls[0][0], "schtasks.exe");
  assert.ok(calls[0][1].includes("ONLOGON"));
  assert.ok(calls[0][1].includes("LIMITED"));
  assert.deepEqual(calls[1][1].slice(0, 2), ["/Run", "/TN"]);
});

test("installs a Linux systemd user service", async () => {
  const { calls, result } = await fixture("linux");
  const unit = await readFile(result.path, "utf8");
  assert.match(unit, /WantedBy=default\.target/);
  assert.match(unit, /ExecStart="\/stable\/node" "\/stable\/agcomm\.js" gateway run/);
  assert.ok(calls.every(([, args]) => args[0] === "--user"));
});

test("rejects unstable temporary Runtime paths", async () => {
  await assert.rejects(() => installGatewayAutostart({ platform: "linux", cliPath: "/tmp/npm-cache/agcomm.js", execute: async () => {} }), (error) => error.code === "GATEWAY_RUNTIME_PATH_UNSTABLE");
});
