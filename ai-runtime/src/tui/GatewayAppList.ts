import type { GatewayClientLike } from "../gateway-loader.ts";
export type GatewayApp = Awaited<ReturnType<GatewayClientLike["listApps"]>>[number];
export function gatewayAppLines(apps: readonly GatewayApp[], selected: number) { return apps.length ? apps.map((app, index) => { const next = Object.values(app.nextRuns).sort()[0]; return `${index === selected ? "›" : " "} ${app.enabled ? "●" : "○"} ${app.name} · ${app.id} · ${app.version}${next ? ` · ${next}` : ""}`; }) : ["  暂无后台应用"]; }
