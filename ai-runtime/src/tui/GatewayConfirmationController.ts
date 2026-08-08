import type { AiAppInfo } from "../runtime-types.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { GatewayClientLike } from "../gateway-loader.ts";
import { disableBackgroundApp, installBackgroundApp } from "./GatewayConfirmationActions.ts";
import { gatewayConfirmationCommand, gatewayConfirmationLines } from "./GatewayConfirmationModel.ts";

export class GatewayConfirmationController {
  constructor(private readonly screen: TerminalScreen, private readonly client: () => Promise<GatewayClientLike>, private readonly connected: () => Promise<GatewayClientLike>, private readonly preflight?: () => Promise<void>, private readonly signal?: AbortSignal) {}
  async run(info: AiAppInfo, path: string) {
    if (!info.background) return true;
    const lines = gatewayConfirmationLines(info);
    for (;;) {
      this.screen.paint("启用 Runtime Gateway", lines, "Y 接受并进入  ·  N 停用并退出");
      const input = await this.screen.key(this.signal);
      const command = gatewayConfirmationCommand(input.text, input.key);
      if (command === "interrupt") throw new DOMException("Interrupted", "AbortError");
      if (command === "reject") { await disableBackgroundApp(await this.connected(), info.background.appId); return false; }
      if (command !== "accept") continue;
      await this.preflight?.();
      if (await installBackgroundApp(this.screen, await this.client(), info, path, this.signal)) return true;
    }
  }
}
