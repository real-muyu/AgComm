import { type AiStreamEvent, type AiStreamMode, type AppBackgroundConfig, type RuntimeOptions } from "@agcomm/ai-runtime/gateway-host";
export type GatewayAppSummary = {
    id: string;
    name: string;
    version: string;
    packageHash: string;
    enabled: boolean;
    installedAt: string;
    updatedAt: string;
    background: AppBackgroundConfig;
    requiresWebhook: boolean;
    webhookUrl?: string;
    notificationAdapters: string[];
    nextRuns: Record<string, string>;
    defaultStreamMode: AiStreamMode;
};
export type GatewayRunRecord = {
    id: string;
    appId: string;
    packageHash: string;
    triggerId: string;
    triggerType: "heartbeat" | "cron";
    scheduledAt: string;
    startedAt: string;
    finishedAt?: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    outputSummary?: string;
    error?: string;
    elapsedMs?: number;
    streamMode: AiStreamMode;
    lastSequence: number;
    streamExpiresAt: string;
};
export type GatewayStartRunOptions = {
    mode?: AiStreamMode;
};
export type GatewayRunTicket = {
    runId: string;
    status: "queued" | "running";
    coalesced: boolean;
};
export type GatewayStreamFrame = {
    sequence: number;
    value: string | AiStreamEvent;
};
export interface GatewayRunStream extends AsyncIterable<GatewayStreamFrame> {
    readonly runId: string;
    readonly mode: AiStreamMode;
    readonly lastSequence: number;
    readonly completion: Promise<GatewayRunRecord>;
}
export type GatewayInboxItem = {
    id: string;
    appId: string;
    packageHash: string;
    nodeId: string;
    triggerId: string;
    runId: string;
    title: string;
    body: string;
    severity: "info" | "warning" | "critical";
    dedupeKey?: string;
    createdAt: string;
    updatedAt: string;
    readAt?: string;
    deliveryStatus: "none" | "queued" | "delivered" | "failed";
};
export type GatewayDelivery = {
    id: string;
    notificationId: string;
    adapterId: string;
    attempts: number;
    nextAttemptAt: string;
    status: "queued" | "delivered" | "failed";
    lastError?: string;
};
export interface GatewayCredentialStore {
    get(appId: string): Promise<string | undefined>;
    set(appId: string, secret: string): Promise<void>;
    delete(appId: string): Promise<void>;
}
export type NotificationAdapterContext = {
    app: GatewayAppSummary;
    signal: AbortSignal;
};
export interface NotificationAdapter {
    readonly id: string;
    deliver(notification: GatewayInboxItem, context: NotificationAdapterContext): Promise<void>;
}
export type RuntimeGatewayOptions = {
    root?: string;
    runtime?: RuntimeOptions;
    credentialStore?: GatewayCredentialStore;
    notificationAdapters?: readonly NotificationAdapter[];
    fetcher?: typeof globalThis.fetch;
    now?: () => Date;
};
export type GatewayInstallOptions = {
    enabled?: boolean;
    webhook?: {
        url: string;
        secret?: string;
    };
    notificationAdapters?: readonly string[];
};
export declare function createGatewayCredentialStore(): GatewayCredentialStore;
export declare class RuntimeGateway {
    private readonly options;
    readonly root: string;
    private registry;
    private readonly credentials;
    private readonly adapters;
    private readonly now;
    private timer?;
    private ipc?;
    private ticking;
    private lockOwner?;
    private readonly stateLocks;
    private readonly active;
    private readonly activeRunIds;
    private readonly pending;
    private readonly completions;
    private readonly streams;
    constructor(options?: RuntimeGatewayOptions);
    private registryPath;
    private appDirectory;
    private statePath;
    private streamDirectory;
    private streamPath;
    private withStateLock;
    private acquireInstanceLock;
    private releaseInstanceLock;
    initialize(): Promise<this>;
    status(): Promise<{
        alive: true;
        pid: number;
        heartbeatAt: string | undefined;
        healthy: boolean;
    }>;
    private saveRegistry;
    private writeRuns;
    private upsertRun;
    private completion;
    private runRecord;
    private waitForRun;
    private createStreamState;
    private appendStream;
    private readStreamFrames;
    private cleanupStreams;
    private app;
    private triggers;
    private nextRun;
    install(pathOrBytes: string | Uint8Array | ArrayBuffer, install?: GatewayInstallOptions): Promise<GatewayAppSummary>;
    enable(id: string): Promise<void>;
    disable(id: string): Promise<void>;
    uninstall(id: string): Promise<void>;
    listApps(): Promise<GatewayAppSummary[]>;
    listRuns(id: string): Promise<{
        streamMode: AiStreamMode;
        lastSequence: number;
        streamExpiresAt: string;
        id: string;
        appId: string;
        packageHash: string;
        triggerId: string;
        triggerType: "heartbeat" | "cron";
        scheduledAt: string;
        startedAt: string;
        finishedAt?: string;
        status: "queued" | "running" | "completed" | "failed" | "cancelled";
        outputSummary?: string;
        error?: string;
        elapsedMs?: number;
    }[]>;
    listInbox(id: string): Promise<GatewayInboxItem[]>;
    markInboxRead(id: string, notificationIds: readonly string[]): Promise<void>;
    retryDelivery(id: string, notificationId: string): Promise<void>;
    private recordContact;
    private previousRun;
    private baseRunRecord;
    private cancelPending;
    private stopActive;
    private launchTrigger;
    private startTrigger;
    private executeTrigger;
    startRunNow(id: string, triggerId: string, options?: GatewayStartRunOptions): Promise<GatewayRunTicket>;
    watchRun(id: string, runId: string, options?: {
        mode?: AiStreamMode;
        afterSequence?: number;
        signal?: AbortSignal;
    }): Promise<GatewayRunStream>;
    private deliverWebhook;
    private deliverPending;
    runNow(id: string, triggerId: string): Promise<void>;
    tick(): Promise<void>;
    start(): Promise<void>;
    dispose(): Promise<void>;
}
export declare function createRuntimeGateway(options?: RuntimeGatewayOptions): RuntimeGateway;
