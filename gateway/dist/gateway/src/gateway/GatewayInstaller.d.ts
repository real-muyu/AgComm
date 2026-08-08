import { type RuntimeOptions } from "@agcomm/ai-runtime/gateway-host";
import { type GatewayAppSummary, type GatewayInstallOptions, type GatewayRegistry, type NotificationAdapter } from "./GatewayState.ts";
export type GatewayInstallerPort = {
    root: string;
    runtime?: RuntimeOptions;
    registry: GatewayRegistry;
    adapters: ReadonlyMap<string, NotificationAdapter>;
    now(): Date;
    credential(id: string): Promise<string | undefined>;
    saveCredential(id: string, secret: string): Promise<void>;
    stopActive(id: string, reason: string): Promise<void>;
    cancelPending(id: string, reason: string): Promise<void>;
    triggers(background: GatewayAppSummary["background"]): Array<{
        id: string;
        everyMs?: number;
        runOnStart?: boolean;
    }>;
    nextRun(trigger: any, after: Date): Date;
    saveRegistry(): Promise<void>;
    statePath(id: string, name: string): string;
};
export declare function installGatewayApplication(port: GatewayInstallerPort, pathOrBytes: string | Uint8Array | ArrayBuffer, install?: GatewayInstallOptions): Promise<GatewayAppSummary>;
