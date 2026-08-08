import { type AiStreamEvent, type AiStreamMode, type AppBackgroundConfig, type ContactReceipt, type ContactRequest, type CronTriggerConfig, type HeartbeatTriggerConfig, type RuntimeOptions } from "@agcomm/ai-runtime/gateway-host";
export declare const STREAM_RETENTION_MS: number;
export declare const MAX_STREAM_RUNS = 100;
export declare const MAX_STREAM_BYTES: number;
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
export type GatewayRegistry = {
    version: 1;
    apps: GatewayAppSummary[];
};
export type GatewayTrigger = HeartbeatTriggerConfig | CronTriggerConfig;
export type PendingRun = {
    runId: string;
    trigger: GatewayTrigger;
    scheduledAt: Date;
    mode: AiStreamMode;
};
export type TriggerSession = {
    messages: Array<{
        role: "user" | "assistant";
        content: string;
    }>;
    packageHash: string;
};
export type TriggerSessions = Record<string, TriggerSession>;
export type RunCompletion = {
    promise: Promise<GatewayRunRecord>;
    resolve(record: GatewayRunRecord): void;
};
export type StreamState = {
    appId: string;
    runId: string;
    mode: AiStreamMode;
    sequence: number;
    bytes: number;
    tail: Promise<void>;
    controller: AbortController;
};
export declare function gatewayAppId(value: string): string;
export declare function atomicWrite(path: string, value: string | Uint8Array): Promise<void>;
export declare function readJson<T>(path: string, fallback: T): Promise<T>;
/** Owns persisted registry paths and per-resource write serialization. */
export declare class GatewayState {
    readonly root: string;
    readonly now: () => Date;
    registry: GatewayRegistry;
    private readonly locks;
    constructor(root: string, now: () => Date);
    private installHandler?;
    bindInstall(handler: (input: string | Uint8Array | ArrayBuffer, options: GatewayInstallOptions) => Promise<GatewayAppSummary>): void;
    install(input: string | Uint8Array | ArrayBuffer, options?: GatewayInstallOptions): Promise<GatewayAppSummary>;
    registryPath(): string;
    appDirectory(id: string): string;
    statePath(id: string, name: string): string;
    streamDirectory(id: string): string;
    streamPath(id: string, runId: string): string;
    app(id: string): GatewayAppSummary;
    withLock<T>(key: string, action: () => Promise<T>): Promise<T>;
    saveRegistry(): Promise<void>;
    initialize(): Promise<void>;
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
    writeRuns(id: string, runs: GatewayRunRecord[]): Promise<void>;
    upsertRun(id: string, record: GatewayRunRecord): Promise<void>;
    runRecord(id: string, runId: string): Promise<{
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
    }>;
    triggerSessions(id: string): Promise<TriggerSessions>;
    saveTriggerSessions(id: string, sessions: TriggerSessions): Promise<void>;
}
export type GatewayContactHandler = (app: GatewayAppSummary, request: ContactRequest) => Promise<ContactReceipt>;
