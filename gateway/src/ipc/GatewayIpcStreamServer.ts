// SPDX-License-Identifier: Elastic-2.0
import type { Socket } from "node:net";
import type { AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type { RuntimeGateway } from "../gateway/RuntimeGateway.ts";

/** Writes an acknowledged Gateway run stream while respecting socket backpressure. */
export async function serveGatewayRunStream(gateway: RuntimeGateway, socket: Socket, args: unknown[]) {
  const controller = new AbortController();
  socket.once("close", () => controller.abort(new DOMException("Gateway subscription closed", "AbortError")));
  const stream = await gateway.watchRun(String(args[0]), String(args[1]), {
    ...((args[2] ?? {}) as { mode?: AiStreamMode; afterSequence?: number }),
    signal: controller.signal,
  });
  socket.write(`${JSON.stringify({ ok: true, value: { runId: stream.runId, mode: stream.mode } })}\n`);
  for await (const frame of stream) {
    if (!socket.write(`${JSON.stringify({ stream: true, frame })}\n`)) {
      await new Promise<void>((resolveDrain, reject) => {
        socket.once("drain", resolveDrain);
        socket.once("error", reject);
      });
    }
  }
  const record = await stream.completion;
  socket.end(`${JSON.stringify({ done: true, record })}\n`);
}
