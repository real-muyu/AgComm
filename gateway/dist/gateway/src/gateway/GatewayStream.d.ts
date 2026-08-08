import { type AiStreamEvent, type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import { type GatewayRunRecord, type GatewayRunStream, type GatewayState, type GatewayStreamFrame, type StreamState } from "./GatewayState.ts";
/** In-memory run completion and stream ownership; persistence stays behind the facade during migration. */
export declare class GatewayStream {
    private readonly state?;
    private readonly now;
    readonly states: Map<string, StreamState>;
    readonly completions: Map<string, {
        promise: Promise<GatewayRunRecord>;
        resolve(record: GatewayRunRecord): void;
    }>;
    constructor(state?: GatewayState | undefined, now?: () => Date);
    private requireState;
    completion(runId: string): {
        promise: Promise<GatewayRunRecord>;
        resolve(record: GatewayRunRecord): void;
    };
    complete(record: GatewayRunRecord): void;
    create(record: GatewayRunRecord, controller: AbortController): StreamState;
    append(state: StreamState, value: string | AiStreamEvent): GatewayStreamFrame;
    readFrames(id: string, runId: string, afterSequence: number): Promise<GatewayStreamFrame[] | undefined>;
    cleanup(id: string, existingRuns?: GatewayRunRecord[]): Promise<void>;
    watch(id: string, runId: string, options?: {
        mode?: AiStreamMode;
        afterSequence?: number;
        signal?: AbortSignal;
    }): Promise<GatewayRunStream>;
}
