import type { AiAppInfo, RuntimeTrustDecision, RuntimeTrustRequest } from "./runtime-types.ts";
import type { RuntimePathRequest } from "./host-permissions.ts";
import { LocalRuntimeConfigStore } from "./local-config.ts";
import { TerminalScreen } from "./terminal-app.ts";
import type { TerminalInput, TerminalOutput } from "./terminal-renderer.ts";
import type { GatewayClientLike } from "./gateway-loader.ts";
import { runGatewayTui } from "./tui/GatewayTuiController.ts";
import { selectTerminalPath } from "./tui/PathSelector.ts";
import { LauncherController } from "./tui/LauncherController.ts";
import { GatewayConfirmationController } from "./tui/GatewayConfirmationController.ts";
import { GatewayConnectionController } from "./tui/GatewayConnectionController.ts";

type TerminalIo = { input?: TerminalInput; output?: TerminalOutput; signal?: AbortSignal };
export type GatewayTerminalIo = TerminalIo & { gateway?: GatewayClientLike; installService?: () => Promise<unknown>; preflight?: () => Promise<void> };

function interrupted(key: { ctrl?: boolean; name?: string }) {
  return key.ctrl && key.name === "c";
}

async function gatewayClient(io: GatewayTerminalIo) {
  return new GatewayConnectionController(io).ensure();
}

async function connectedGatewayClient(io: GatewayTerminalIo) {
  return new GatewayConnectionController(io).connected();
}

export async function confirmTerminalGateway(info: AiAppInfo, path: string, io: GatewayTerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr);
  screen.enter();
  try { return await new GatewayConfirmationController(screen, () => gatewayClient(io), () => connectedGatewayClient(io), io.preflight, io.signal).run(info, path); }
  finally { screen.leave(); }
}

export async function runTerminalGatewayManager(io: GatewayTerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr);
  screen.enter();
  try { await runGatewayTui(screen, await gatewayClient(io), io.signal); } finally { screen.leave(); }
}

export async function runTerminalSettings(store: LocalRuntimeConfigStore, io: TerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr);
  screen.enter();
  try { await new LauncherController(screen, store, () => gatewayClient(io), io.signal).runSettings(); }
  finally { screen.leave(); }
}

export async function runTerminalLauncher(store: LocalRuntimeConfigStore, io: GatewayTerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr);
  screen.enter();
  try { return await new LauncherController(screen, store, () => gatewayClient(io), io.signal).run(); }
  finally { screen.leave(); }
}

export async function selectTerminalPermissionPath(request: RuntimePathRequest, signal: AbortSignal, io: TerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr, false);
  screen.enter();
  try { return await selectTerminalPath(screen, { title: request.kind === "document" ? "选择文档" : "选择文件", extensions: request.extensions, mode: request.mode }, signal); }
  finally { screen.leave(); }
}

export async function promptTerminalTrust(request: RuntimeTrustRequest, io: TerminalIo = {}): Promise<RuntimeTrustDecision> {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr, false);
  screen.enter();
  try {
    const lines = [
      request.signature ? `签名发布者：${request.signature.keyId}` : "警告：此 bundle 未签名，无法确认发布者身份。",
      `类型：${request.kind}`,
      `ID：${request.bundleId}`,
      `版本：${request.version}`,
      `包哈希：${request.packageHash.slice(0, 32)}…`,
      `Integrity：${request.integrity}`,
      `权限：${request.permissions.join("、") || "无"}`,
      "",
      "是否信任并记住此授权？",
    ];
    for (;;) {
      screen.paint("Runtime Bundle 授权", lines, "Y 信任  ·  N 拒绝");
      const { text, key } = await screen.key(io.signal);
      if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
      if (key.name === "escape" || text?.toLowerCase() === "n") return { trusted: false };
      if (text?.toLowerCase() === "y") return { trusted: true, allowUnsigned: !request.signature, grants: [...request.permissions] };
    }
  } finally { screen.leave(); }
}
