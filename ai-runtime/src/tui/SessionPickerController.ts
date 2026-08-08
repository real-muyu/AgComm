import type { AiAppHandle, AiSessionHandle } from "../runtime-types.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import { openSelectedSession, renameSelectedSession } from "./SessionPickerActions.ts";
import { sessionPickerCommand } from "./SessionPickerCommand.ts";
import { SessionPickerState } from "./SessionPickerState.ts";

export class SessionPickerController {
  private readonly state = new SessionPickerState();
  async run(screen: TerminalScreen, app: AiAppHandle, signal?: AbortSignal): Promise<AiSessionHandle | undefined> {
    for (;;) {
      this.state.update(await app.listSessions());
      screen.paint(`${app.name} · 会话`, this.state.rows(), "↑↓ 选择  ·  Enter 打开  ·  R 重命名  ·  D 删除  ·  Q 退出");
      const input = await screen.key(signal);
      const command = sessionPickerCommand(input.text, input.key);
      if (command === "quit") return undefined;
      if (command === "up" || command === "down") this.state.move(command === "up" ? -1 : 1);
      if (command === "open") return openSelectedSession(app, this.state.selectedItem());
      const selected = this.state.selectedExisting();
      if (command === "delete" && selected) { await app.deleteSession(selected.id); this.state.afterDelete(); }
      if (command === "rename" && selected) await renameSelectedSession(screen, app, selected, signal);
    }
  }
}
