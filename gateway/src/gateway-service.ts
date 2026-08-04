// SPDX-License-Identifier: Elastic-2.0
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";

const execute = promisify(execFile);
const SERVICE_NAME = "io.agcomm.runtime.gateway";

export type GatewayServiceOptions = {
  cliPath?: string;
  nodePath?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  execute?: (file: string, args: readonly string[]) => Promise<unknown>;
};

function paths(options: GatewayServiceOptions) {
  const cliPath = resolve(options.cliPath ?? process.argv[1] ?? "");
  const nodePath = resolve(options.nodePath ?? process.execPath);
  const home = resolve(options.homeDir ?? homedir());
  if (!cliPath || /(?:^|[/\\])(?:_npx|npm-cache|Temp|tmp)(?:[/\\])/i.test(cliPath)) {
    throw new AiRuntimeError("GATEWAY_RUNTIME_PATH_UNSTABLE", "Gateway login service requires @agcomm/ai-runtime to be installed at a stable path");
  }
  return { cliPath, nodePath, home };
}

function xml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function systemd(value: string) { return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`; }

async function command(options: GatewayServiceOptions, file: string, args: string[], code: string) {
  try { return options.execute ? await options.execute(file, args) : await execute(file, args, { timeout: 15_000 }); }
  catch (error) { throw new AiRuntimeError(code, `Unable to configure Runtime Gateway login service using ${file}`, { cause: error }); }
}

export async function installGatewayAutostart(options: GatewayServiceOptions = {}) {
  const { cliPath, nodePath, home } = paths(options);
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const path = join(home, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${SERVICE_NAME}</string><key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(cliPath)}</string><string>gateway</string><string>run</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string></dict></plist>\n`, { mode: 0o600 });
    try { await command(options, "launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, path], "GATEWAY_SERVICE_UNAVAILABLE"); } catch { /* Service may not be loaded yet. */ }
    await command(options, "launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, path], "GATEWAY_SERVICE_UNAVAILABLE");
    return { platform: "darwin" as const, path };
  }
  if (platform === "win32") {
    const task = "AgComm Runtime Gateway";
    const invocation = `"${nodePath}" "${cliPath}" gateway run`;
    await command(options, "schtasks.exe", ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", task, "/TR", invocation], "GATEWAY_SERVICE_UNAVAILABLE");
    await command(options, "schtasks.exe", ["/Run", "/TN", task], "GATEWAY_SERVICE_UNAVAILABLE");
    return { platform: "win32" as const, path: task };
  }
  if (platform === "linux") {
    const path = join(home, ".config", "systemd", "user", "agcomm-runtime-gateway.service");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `[Unit]\nDescription=AgComm Runtime Gateway\n\n[Service]\nType=simple\nExecStart=${systemd(nodePath)} ${systemd(cliPath)} gateway run\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`, { mode: 0o600 });
    await command(options, "systemctl", ["--user", "daemon-reload"], "GATEWAY_SERVICE_UNAVAILABLE");
    await command(options, "systemctl", ["--user", "enable", "--now", "agcomm-runtime-gateway.service"], "GATEWAY_SERVICE_UNAVAILABLE");
    return { platform: "linux" as const, path };
  }
  throw new AiRuntimeError("GATEWAY_SERVICE_UNAVAILABLE", `Runtime Gateway login service is not supported on ${platform}`);
}

export async function uninstallGatewayAutostart(options: GatewayServiceOptions = {}) {
  const { home } = paths(options);
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const path = join(home, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
    try { await command(options, "launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, path], "GATEWAY_SERVICE_UNAVAILABLE"); } catch { /* Already stopped. */ }
    await rm(path, { force: true });
    return;
  }
  if (platform === "win32") { try { await command(options, "schtasks.exe", ["/Delete", "/F", "/TN", "AgComm Runtime Gateway"], "GATEWAY_SERVICE_UNAVAILABLE"); } catch { /* Already removed. */ } return; }
  if (platform === "linux") {
    try { await command(options, "systemctl", ["--user", "disable", "--now", "agcomm-runtime-gateway.service"], "GATEWAY_SERVICE_UNAVAILABLE"); } catch { /* Already stopped. */ }
    await rm(join(home, ".config", "systemd", "user", "agcomm-runtime-gateway.service"), { force: true });
    await command(options, "systemctl", ["--user", "daemon-reload"], "GATEWAY_SERVICE_UNAVAILABLE");
    return;
  }
  throw new AiRuntimeError("GATEWAY_SERVICE_UNAVAILABLE", `Runtime Gateway login service is not supported on ${platform}`);
}
