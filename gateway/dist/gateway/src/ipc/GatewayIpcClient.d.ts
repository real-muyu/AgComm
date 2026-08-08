import { type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type { GatewayAppSummary, GatewayInboxItem, GatewayInstallOptions, GatewayRunRecord, GatewayRunStream, GatewayStartRunOptions, GatewayRunTicket } from "../gateway/RuntimeGateway.ts";
export interface RuntimeGatewayClient {
    ping(): Promise<{
        alive: true;
        pid: number;
        heartbeatAt?: string;
        healthy: boolean;
    }>;
    listApps(): Promise<GatewayAppSummary[]>;
    install(path: string, options?: GatewayInstallOptions): Promise<GatewayAppSummary>;
    enable(id: string): Promise<void>;
    disable(id: string): Promise<void>;
    uninstall(id: string): Promise<void>;
    runNow(id: string, triggerId: string): Promise<void>;
    startRunNow(id: string, triggerId: string, options?: GatewayStartRunOptions): Promise<GatewayRunTicket>;
    watchRun(id: string, runId: string, options?: {
        mode?: AiStreamMode;
        afterSequence?: number;
        signal?: AbortSignal;
    }): Promise<GatewayRunStream>;
    listRuns(id: string): Promise<GatewayRunRecord[]>;
    listInbox(id: string): Promise<GatewayInboxItem[]>;
    markInboxRead(id: string, notificationIds: readonly string[]): Promise<void>;
    retryDelivery(id: string, notificationId: string): Promise<void>;
}
export declare function connectRuntimeGateway(options?: {
    root?: string;
}): Promise<RuntimeGatewayClient>;
