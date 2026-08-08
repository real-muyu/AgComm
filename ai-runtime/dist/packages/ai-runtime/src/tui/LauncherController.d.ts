import type { LocalRuntimeConfigStore } from "../local-config.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { GatewayClientLike } from "../gateway-loader.ts";
export declare class LauncherController {
    private readonly screen;
    private readonly store;
    private readonly gateway;
    private readonly signal?;
    constructor(screen: TerminalScreen, store: LocalRuntimeConfigStore, gateway: () => Promise<GatewayClientLike>, signal?: AbortSignal | undefined);
    private settings;
    runSettings(): Promise<void>;
    run(): Promise<string | undefined>;
}
