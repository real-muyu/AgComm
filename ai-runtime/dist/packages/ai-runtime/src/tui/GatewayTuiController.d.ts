import type { GatewayClientLike } from "../gateway-loader.ts";
import type { TerminalScreen } from "../terminal-app.ts";
export declare function runGatewayTui(screen: TerminalScreen, client: GatewayClientLike, signal?: AbortSignal): Promise<void>;
