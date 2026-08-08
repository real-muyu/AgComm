import type { GatewayClientLike } from "../gateway-loader.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { GatewayApp } from "./GatewayAppList.ts";
export declare function showGatewayHistory(screen: TerminalScreen, client: GatewayClientLike, app: GatewayApp, signal?: AbortSignal): Promise<void>;
