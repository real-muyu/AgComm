import type { AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type { GatewayRunStream } from "../gateway/RuntimeGateway.ts";
export declare function connectGatewayRunStream(root: string, secret: string, id: string, runId: string, watch?: {
    mode?: AiStreamMode;
    afterSequence?: number;
    signal?: AbortSignal;
}): Promise<GatewayRunStream>;
