import { type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type { GatewayRunRecord, GatewayRunStream, GatewayStreamFrame } from "./GatewayState.ts";
export type GatewayWatchPort = {
    now(): Date;
    runRecord(id: string, runId: string): Promise<GatewayRunRecord>;
    waitForRun(id: string, runId: string): Promise<GatewayRunRecord>;
    readFrames(id: string, runId: string, after: number): Promise<GatewayStreamFrame[] | undefined>;
};
export declare function watchGatewayRun(port: GatewayWatchPort, id: string, runId: string, options?: {
    mode?: AiStreamMode;
    afterSequence?: number;
    signal?: AbortSignal;
}): Promise<GatewayRunStream>;
