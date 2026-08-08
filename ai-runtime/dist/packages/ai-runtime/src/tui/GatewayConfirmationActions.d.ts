import type { AiAppInfo } from "../runtime-types.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { GatewayClientLike } from "../gateway-loader.ts";
export declare function disableBackgroundApp(client: GatewayClientLike, appId: string): Promise<void>;
export declare function installBackgroundApp(screen: TerminalScreen, client: GatewayClientLike, info: AiAppInfo, path: string, signal?: AbortSignal): Promise<boolean>;
