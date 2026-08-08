import type { AiAppInfo } from "../runtime-types.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { GatewayClientLike } from "../gateway-loader.ts";
export declare class GatewayConfirmationController {
    private readonly screen;
    private readonly client;
    private readonly connected;
    private readonly preflight?;
    private readonly signal?;
    constructor(screen: TerminalScreen, client: () => Promise<GatewayClientLike>, connected: () => Promise<GatewayClientLike>, preflight?: (() => Promise<void>) | undefined, signal?: AbortSignal | undefined);
    run(info: AiAppInfo, path: string): Promise<boolean>;
}
