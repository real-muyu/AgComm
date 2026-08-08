// SPDX-License-Identifier: Elastic-2.0
import { chmod, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";
import type { RuntimeGateway } from "../gateway/RuntimeGateway.ts";
import { gatewayIpcEndpoint, gatewayIpcToken } from "./GatewayIpcAuth.ts";
import { dispatchGatewayIpc, gatewayIpcFailure } from "./GatewayIpcDispatcher.ts";
import { serveGatewayRunStream } from "./GatewayIpcStreamServer.ts";
import type { GatewayIpcRequest as Request } from "./GatewayIpcProtocol.ts";

export async function createGatewayIpcServer(gateway: RuntimeGateway, root: string) {
  const secret = await gatewayIpcToken(root, true);
  const path = gatewayIpcEndpoint(root);
  if (process.platform !== "win32") await rm(path, { force: true });
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1_048_576) { socket.destroy(); return; }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      void (async () => {
        try {
          const request = JSON.parse(line) as Request;
          if (request.token !== secret) throw new AiRuntimeError("GATEWAY_AUTH_FAILED", "Gateway IPC authentication failed");
          if (request.operation === "watchRun") {
            await serveGatewayRunStream(gateway, socket, request.args ?? []);
            return;
          }
          socket.end(`${JSON.stringify({ ok: true, value: await dispatchGatewayIpc(gateway, request) })}\n`);
        } catch (error) {
          if (!socket.destroyed) socket.end(`${JSON.stringify(gatewayIpcFailure(error))}\n`);
        }
      })();
    });
  });
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(path, () => { server.off("error", reject); resolveListen(); }); });
  if (process.platform !== "win32") try { await chmod(path, 0o600); } catch { await new Promise<void>((resolveClose) => server.close(() => resolveClose())); throw new AiRuntimeError("GATEWAY_IPC_PERMISSIONS", "Unable to restrict Gateway IPC socket permissions"); }
  return {
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      if (process.platform !== "win32") await rm(path, { force: true });
    },
  };
}
