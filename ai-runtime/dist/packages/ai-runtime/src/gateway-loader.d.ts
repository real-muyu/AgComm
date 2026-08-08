import type { RuntimeOptions } from "./runtime-types.ts";
export type GatewayClientLike = {
    ping(): Promise<{
        alive: true;
        pid: number;
        heartbeatAt?: string;
        healthy: boolean;
    }>;
    install(path: string, options?: {
        enabled?: boolean;
        webhook?: {
            url: string;
            secret?: string;
        };
    }): Promise<unknown>;
    enable(id: string): Promise<void>;
    disable(id: string): Promise<void>;
    uninstall(id: string): Promise<void>;
    listApps(): Promise<Array<{
        id: string;
        name: string;
        version: string;
        enabled: boolean;
        webhookUrl?: string;
        nextRuns: Record<string, string>;
    }>>;
    startRunNow(id: string, triggerId: string): Promise<{
        runId: string;
    }>;
    watchRun(id: string, runId: string, options: {
        mode: "text";
        signal?: AbortSignal;
    }): Promise<AsyncIterable<{
        sequence: number;
        value: unknown;
    }> & {
        completion: Promise<{
            status: string;
            elapsedMs?: number;
            error?: string;
        }>;
    }>;
    listRuns(id: string): Promise<Array<{
        status: string;
        triggerId: string;
        startedAt: string;
        elapsedMs?: number;
        outputSummary?: string;
        error?: string;
    }>>;
    listInbox(id: string): Promise<Array<{
        id: string;
        title: string;
        body: string;
        severity: string;
        deliveryStatus: string;
        createdAt: string;
        readAt?: string;
    }>>;
    markInboxRead(id: string, itemIds: readonly string[]): Promise<void>;
    retryDelivery(id: string, notificationId: string): Promise<void>;
};
export type GatewayInstanceLike = {
    start(): Promise<void>;
    dispose(): Promise<void>;
};
type GatewayModule = {
    connectRuntimeGateway(options?: {
        root?: string;
    }): Promise<GatewayClientLike>;
    installGatewayAutostart(): Promise<unknown>;
};
export declare function loadGatewayModule(): Promise<GatewayModule>;
export declare function connectRuntimeGateway(options?: {
    root?: string;
}): Promise<GatewayClientLike>;
export declare function installGatewayAutostart(): Promise<unknown>;
export declare function startRuntimeGateway(options?: {
    runtime?: RuntimeOptions;
}): Promise<GatewayInstanceLike>;
export {};
