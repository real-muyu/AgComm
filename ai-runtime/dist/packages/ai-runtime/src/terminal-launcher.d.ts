import type { AiAppInfo, RuntimeTrustDecision, RuntimeTrustRequest } from "./runtime-types.ts";
import type { RuntimePathRequest } from "./host-permissions.ts";
import { LocalRuntimeConfigStore } from "./local-config.ts";
import type { TerminalInput, TerminalOutput } from "./terminal-renderer.ts";
import { type GatewayClientLike } from "./gateway-loader.ts";
type TerminalIo = {
    input?: TerminalInput;
    output?: TerminalOutput;
    signal?: AbortSignal;
};
export type GatewayTerminalIo = TerminalIo & {
    gateway?: GatewayClientLike;
    installService?: () => Promise<unknown>;
    preflight?: () => Promise<void>;
};
export declare function confirmTerminalGateway(info: AiAppInfo, path: string, io?: GatewayTerminalIo): Promise<boolean>;
export declare function runTerminalGatewayManager(io?: GatewayTerminalIo): Promise<void>;
export declare function runTerminalSettings(store: LocalRuntimeConfigStore, io?: TerminalIo): Promise<void>;
export declare function runTerminalLauncher(store: LocalRuntimeConfigStore, io?: GatewayTerminalIo): Promise<string | undefined>;
export declare function selectTerminalPermissionPath(request: RuntimePathRequest, signal: AbortSignal, io?: TerminalIo): Promise<string | undefined>;
export declare function promptTerminalTrust(request: RuntimeTrustRequest, io?: TerminalIo): Promise<RuntimeTrustDecision>;
export {};
