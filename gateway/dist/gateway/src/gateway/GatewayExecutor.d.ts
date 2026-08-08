import { type AiStreamMode, type RuntimeOptions } from "@agcomm/ai-runtime/gateway-host";
import { type GatewayAppSummary, type GatewayRunRecord, type GatewayRunTicket, type GatewayState, type GatewayTrigger, type PendingRun } from "./GatewayState.ts";
import type { GatewayExecutionPort } from "./GatewayExecutionPort.ts";
import type { GatewayNotifier } from "./GatewayNotifier.ts";
import type { GatewayStream } from "./GatewayStream.ts";
type ExecutorServices = {
    state: GatewayState;
    stream: GatewayStream;
    notifier: GatewayNotifier;
    runtime?: RuntimeOptions;
    now(): Date;
};
/** Owns active runs, coalesced queues and trigger execution. */
export declare class GatewayExecutor implements GatewayExecutionPort {
    readonly active: Map<string, AbortController>;
    readonly activeRunIds: Map<string, string>;
    readonly pending: Map<string, Map<string, PendingRun>>;
    private services?;
    configure(services: ExecutorServices): void;
    private service;
    activeFor(app: GatewayAppSummary): boolean;
    queue(app: GatewayAppSummary, pending: PendingRun): PendingRun | undefined;
    release(record: GatewayRunRecord): void;
    next(appId: string): PendingRun | undefined;
    private completion;
    private baseRecord;
    cancelPending(id: string, reason: string): Promise<void>;
    stopActive(id: string, reason: string): Promise<void>;
    start(app: GatewayAppSummary, trigger: GatewayTrigger, scheduledAt: Date, mode: AiStreamMode): Promise<GatewayRunTicket>;
    private previous;
    private launch;
    private failLaunch;
    private execute;
    private launchNext;
}
export {};
