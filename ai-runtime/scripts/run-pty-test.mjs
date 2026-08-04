import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("PTY/TUI acceptance currently requires macOS expect(1)");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "dist/cli.js");
const fixture = resolve(root, "../../test-fixtures/ai/01-basic-input-output.ai");
const driver = resolve(root, "scripts/pty-tui.expect");
const child = spawn("expect", [driver], {
  env: { ...process.env, AI_RUNTIME_PTY_CLI: cli, AI_RUNTIME_PTY_FIXTURE: fixture, AI_RUNTIME_PTY_NODE: process.execPath },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let errors = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { errors += chunk; });
const [code] = await once(child, "close");
assert.equal(code, 0, `PTY child failed:\n${output}\n${errors}`);
assert.match(output, /\u001b\[\?1049h/);
assert.match(output, /\u001b\[\?1049l/);
const match = output.match(/\{"ok":true[^\r\n]*\}/);
assert.ok(match, "expected final JSON after the terminal UI closes");
assert.equal(JSON.parse(match[0]).status, "completed");
process.stdout.write("PTY/TUI acceptance passed\n");
