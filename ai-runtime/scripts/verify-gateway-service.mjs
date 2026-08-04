import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectRuntimeGateway, installGatewayAutostart } from "@agcomm/gateway";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(root, "dist/cli.js");

const service = await installGatewayAutostart({ cliPath, nodePath: process.execPath });
let status;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const client = await connectRuntimeGateway();
    status = await client.ping();
    if (status.healthy) break;
  } catch {
    // The service manager may need a moment to start the process and IPC server.
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
}
if (!status?.healthy) throw new Error("Gateway did not expose a healthy IPC heartbeat within 10 seconds");

let managerState;
if (process.platform === "darwin") {
  managerState = (await execute("launchctl", ["print", `gui/${process.getuid()}/io.agcomm.runtime.gateway`], { timeout: 15_000 })).stdout;
} else if (process.platform === "win32") {
  managerState = (await execute("schtasks.exe", ["/Query", "/TN", "AgComm Runtime Gateway", "/FO", "LIST", "/V"], { timeout: 15_000 })).stdout;
} else if (process.platform === "linux") {
  const enabled = await execute("systemctl", ["--user", "is-enabled", "agcomm-runtime-gateway.service"], { timeout: 15_000 });
  const active = await execute("systemctl", ["--user", "is-active", "agcomm-runtime-gateway.service"], { timeout: 15_000 });
  managerState = `${enabled.stdout.trim()} / ${active.stdout.trim()}`;
} else {
  throw new Error(`Gateway system acceptance is unsupported on ${process.platform}`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  platform: process.platform,
  service: service.path,
  pid: status.pid,
  heartbeatAt: status.heartbeatAt,
  managerState: managerState.trim().slice(0, 160),
})}\n`);
