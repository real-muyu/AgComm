import type { GatewayClientLike } from "../gateway-loader.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { GatewayApp } from "./GatewayAppList.ts";
export async function showGatewayHistory(screen: TerminalScreen, client: GatewayClientLike, app: GatewayApp, signal?: AbortSignal) { const runs = (await client.listRuns(app.id)).slice(-100).reverse(); screen.paint(`${app.name} · 运行历史`, runs.flatMap((run) => [`${run.status === "completed" ? "✓" : "×"} ${run.triggerId} · ${run.startedAt} · ${run.elapsedMs}ms`, run.outputSummary ?? run.error ?? "", ""]), "任意键返回"); await screen.key(signal); }
