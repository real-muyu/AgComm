// SPDX-License-Identifier: Elastic-2.0
import { createConnection } from "node:net";
import type { AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type { GatewayRunStream } from "../gateway/RuntimeGateway.ts";
import { gatewayIpcEndpoint } from "./GatewayIpcAuth.ts";
import { GatewayRunStreamConnection } from "./GatewayRunStreamConnection.ts";

export function connectGatewayRunStream(root: string, secret: string, id: string, runId: string, watch: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal } = {}): Promise<GatewayRunStream> {
  return new Promise<GatewayRunStream>((resolveStream, rejectStream) => {
    if (watch.signal?.aborted) {
      rejectStream(watch.signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const socket = createConnection(gatewayIpcEndpoint(root));
    socket.setEncoding("utf8");
    const connection = new GatewayRunStreamConnection(socket, watch.afterSequence, resolveStream, rejectStream);
    const abort = () => {
      const reason = watch.signal?.reason ?? new DOMException("Aborted", "AbortError");
      connection.fail(reason);
      socket.destroy();
    };
    watch.signal?.addEventListener("abort", abort, { once: true });
    socket.once("error", (error) => connection.fail(error));
    socket.once("close", () => {
      watch.signal?.removeEventListener("abort", abort);
      connection.closeUnexpectedly();
    });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({
        token: secret,
        operation: "watchRun",
        args: [id, runId, { mode: watch.mode, afterSequence: watch.afterSequence }],
      })}\n`);
    });
    socket.on("data", (chunk) => connection.onData(String(chunk)));
   });
}
