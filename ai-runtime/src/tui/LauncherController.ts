import type { LocalRuntimeConfigStore } from "../local-config.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { GatewayClientLike } from "../gateway-loader.ts";
import { runGatewayTui } from "./GatewayTuiController.ts";
import { selectTerminalPath } from "./PathSelector.ts";
import { manageTerminalProviders } from "./ProviderController.ts";
import { manageTerminalKeys, manageTerminalTrust } from "./TrustController.ts";

export class LauncherController {
  constructor(private readonly screen: TerminalScreen, private readonly store: LocalRuntimeConfigStore, private readonly gateway: () => Promise<GatewayClientLike>, private readonly signal?: AbortSignal) {}
  private async settings() { let selected = 0; const items = ["Provider Profiles", "可信发布者", "Bundle 授权"]; for (;;) { this.screen.paint("AgComm Runtime · 设置", items.map((item, index) => `${index === selected ? "›" : " "} ${item}`), "↑↓ 选择  ·  Enter 打开  ·  Q 返回"); const { text, key } = await this.screen.key(this.signal); if (key.ctrl && key.name === "c") throw new DOMException("Interrupted", "AbortError"); if (key.name === "escape" || text?.toLowerCase() === "q") return; if (key.name === "up") selected = (selected + items.length - 1) % items.length; else if (key.name === "down") selected = (selected + 1) % items.length; else if (key.name === "return") await [manageTerminalProviders, manageTerminalKeys, manageTerminalTrust][selected](this.screen, this.store, this.signal); } }
  async runSettings() { return this.settings(); }
  async run(): Promise<string | undefined> { let selected = 0; const items = ["打开 .ai", "Gateway", "设置", "退出"]; for (;;) { const profile = await this.store.selectedProfile(); this.screen.paint("AgComm Runtime", [...items.map((item, index) => `${index === selected ? "›" : " "} ${item}`), "", `Provider: ${profile?.label ?? "未配置"}`], "↑↓ 选择  ·  Enter 确认"); const { key } = await this.screen.key(this.signal); if (key.ctrl && key.name === "c") throw new DOMException("Interrupted", "AbortError"); if (key.name === "escape") return; if (key.name === "up") selected = (selected + items.length - 1) % items.length; else if (key.name === "down") selected = (selected + 1) % items.length; else if (key.name === "return") { if (selected === 0) { const path = await selectTerminalPath(this.screen, { title: "打开 .ai", extensions: [".ai"] }, this.signal); if (path) return path; } else if (selected === 1) await runGatewayTui(this.screen, await this.gateway(), this.signal); else if (selected === 2) await this.settings(); else return; } } }
}
