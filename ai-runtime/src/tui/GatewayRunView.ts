import type { GatewayClientLike } from "../gateway-loader.ts";
import type { GatewayApp } from "./GatewayAppList.ts";
import type { TerminalScreenPort } from "./TerminalScreenPort.ts";

type GatewayRunStream = Awaited<ReturnType<GatewayClientLike["watchRun"]>>;
type GatewayRunCompletion = Awaited<GatewayRunStream["completion"]>;
type TriggerSelectionCommand = "cancel" | "previous" | "next" | "select" | "none";

export async function runGatewayTrigger(
  screen: TerminalScreenPort,
  client: GatewayClientLike,
  app: GatewayApp,
  signal?: AbortSignal,
): Promise<string> {
  const triggerId = await selectGatewayTrigger(screen, app, signal);
  if (triggerId === undefined) return "";
  if (!triggerId) return "没有可运行的触发器";
  const record = await executeGatewayTrigger(screen, client, app, triggerId, signal);
  return formatGatewayRunCompletion(record);
}

async function selectGatewayTrigger(
  screen: TerminalScreenPort,
  app: GatewayApp,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const triggers = Object.keys(app.nextRuns);
  if (triggers.length <= 1) return triggers[0] ?? "";
  let selected = 0;
  for (;;) {
    screen.paint(
      `${app.name} · 立即运行`,
      triggers.map((id, index) => `${index === selected ? "›" : " "} ${id}`),
      "↑↓ 选择  ·  Enter 运行  ·  Q 返回",
    );
    const choice = await screen.key(signal);
    const command = triggerSelectionCommand(choice.text, choice.key.name);
    if (command === "cancel") return undefined;
    if (command === "select") return triggers[selected];
    selected = moveTriggerSelection(selected, triggers.length, command);
  }
}

function triggerSelectionCommand(text: string | undefined, keyName: string | undefined): TriggerSelectionCommand {
  if (keyName === "escape" || text?.toLowerCase() === "q") return "cancel";
  if (keyName === "up") return "previous";
  if (keyName === "down") return "next";
  if (keyName === "return") return "select";
  return "none";
}

function moveTriggerSelection(selected: number, count: number, command: TriggerSelectionCommand): number {
  if (command === "previous") return (selected + count - 1) % count;
  if (command === "next") return (selected + 1) % count;
  return selected;
}

async function executeGatewayTrigger(
  screen: TerminalScreenPort,
  client: GatewayClientLike,
  app: GatewayApp,
  triggerId: string,
  signal?: AbortSignal,
): Promise<GatewayRunCompletion> {
  const ticket = await client.startRunNow(app.id, triggerId);
  const stream = await client.watchRun(app.id, ticket.runId, { mode: "text", signal });
  let output = "";
  screen.paint(`${app.name} · ${triggerId}`, ["等待输出…"], "后台运行中");
  for await (const frame of stream) {
    output = `${output}${String(frame.value)}`.slice(-64_000);
    screen.paint(
      `${app.name} · ${triggerId}`,
      output ? output.split("\n").slice(-40) : ["等待输出…"],
      `后台运行中 · sequence ${frame.sequence}`,
    );
  }
  return stream.completion;
}

function formatGatewayRunCompletion(record: GatewayRunCompletion): string {
  if (record.status === "completed") return `运行完成 · ${record.elapsedMs ?? 0}ms`;
  const status = record.status === "cancelled" ? "已取消" : "失败";
  return `运行${status} · ${record.error ?? "未知错误"}`;
}
