import type { Socket } from "node:net";
import type { RuntimeGateway } from "../gateway/RuntimeGateway.ts";
/** Writes an acknowledged Gateway run stream while respecting socket backpressure. */
export declare function serveGatewayRunStream(gateway: RuntimeGateway, socket: Socket, args: unknown[]): Promise<void>;
