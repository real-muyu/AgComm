import type { GatewayClientLike } from "../gateway-loader.ts";
import type { GatewayApp } from "./GatewayAppList.ts";
import { gatewayInboxCommand, type GatewayInboxCommand } from "./GatewayInboxCommand.ts";
import { GatewayInboxState } from "./GatewayInboxState.ts";
import type { TerminalScreenPort } from "./TerminalScreenPort.ts";

export async function showGatewayInbox(
  screen: TerminalScreenPort,
  client: GatewayClientLike,
  app: GatewayApp,
  signal?: AbortSignal,
): Promise<void> {
  const state = new GatewayInboxState();
  for (;;) {
    state.update(await client.listInbox(app.id));
    screen.paint(
      `${app.name} · Inbox`,
      state.lines(),
      "↑↓ 选择  ·  Enter 标记已读  ·  R 重试失败投递  ·  Q 返回",
    );
    const input = await screen.key(signal);
    const command = gatewayInboxCommand(input.text, input.key);
    if (command === "quit") return;
    await applyInboxCommand(command, state, client, app.id);
  }
}

async function applyInboxCommand(
  command: Exclude<GatewayInboxCommand, "quit">,
  state: GatewayInboxState,
  client: GatewayClientLike,
  appId: string,
): Promise<void> {
  if (command === "previous") state.move(-1);
  if (command === "next") state.move(1);
  if (command === "read" && state.current) await client.markInboxRead(appId, [state.current.id]);
  if (command === "retry" && state.current?.deliveryStatus === "failed") {
    await client.retryDelivery(appId, state.current.id);
  }
}
