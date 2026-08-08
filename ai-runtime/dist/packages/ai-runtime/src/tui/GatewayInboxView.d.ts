import type { GatewayClientLike } from "../gateway-loader.ts";
import type { GatewayApp } from "./GatewayAppList.ts";
import type { TerminalScreenPort } from "./TerminalScreenPort.ts";
export declare function showGatewayInbox(screen: TerminalScreenPort, client: GatewayClientLike, app: GatewayApp, signal?: AbortSignal): Promise<void>;
