// SPDX-License-Identifier: Elastic-2.0
import { resolve } from "node:path";
import { createConnection } from "node:net";
import { AiRuntimeError, type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type {
  GatewayAppSummary,
  GatewayInboxItem,
  GatewayInstallOptions,
  GatewayRunRecord,
  GatewayRunStream,
  GatewayStartRunOptions,
  GatewayRunTicket,
} from "../gateway/RuntimeGateway.ts";
import { defaultGatewayRoot, gatewayIpcEndpoint, gatewayIpcToken } from "./GatewayIpcAuth.ts";
import { connectGatewayRunStream } from "./GatewayIpcRunStream.ts";
import type { GatewayIpcResponse as Response } from "./GatewayIpcProtocol.ts";

export interface RuntimeGatewayClient {
  ping(): Promise<{ alive: true; pid: number; heartbeatAt?: string; healthy: boolean }>;
  listApps(): Promise<GatewayAppSummary[]>;
  install(path: string, options?: GatewayInstallOptions): Promise<GatewayAppSummary>;
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  runNow(id: string, triggerId: string): Promise<void>;
  startRunNow(id: string, triggerId: string, options?: GatewayStartRunOptions): Promise<GatewayRunTicket>;
  watchRun(
    id: string,
    runId: string,
    options?: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal },
  ): Promise<GatewayRunStream>;
  listRuns(id: string): Promise<GatewayRunRecord[]>;
  listInbox(id: string): Promise<GatewayInboxItem[]>;
  markInboxRead(id: string, notificationIds: readonly string[]): Promise<void>;
  retryDelivery(id: string, notificationId: string): Promise<void>;
}

export async function connectRuntimeGateway(options: { root?: string } = {}): Promise<RuntimeGatewayClient> {
  const root = resolve(options.root ?? defaultGatewayRoot());
  const secret = await gatewayIpcToken(root, false);
  const call = <T>(operation: string, args: unknown[] = []) => new Promise<T>((resolveCall, reject) => {
    const socket = createConnection(gatewayIpcEndpoint(root));
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };
    socket.once("error", (error) => finish(() => reject(new AiRuntimeError("GATEWAY_UNAVAILABLE", "Runtime Gateway is not running", { cause: error }))));
    socket.setTimeout(10_000, () => finish(() => reject(new AiRuntimeError("GATEWAY_UNAVAILABLE", "Runtime Gateway did not respond within 10 seconds"))));
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: secret, operation, args })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as Response;
        if (!response.ok) finish(() => reject(new AiRuntimeError(response.error.code, response.error.message)));
        else finish(() => resolveCall(response.value as T));
      } catch (error) { finish(() => reject(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned an invalid response", { cause: error }))); }
    });
  });
  const watchRun = (id: string, runId: string, watch: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal } = {}) => connectGatewayRunStream(root, secret, id, runId, watch);
  return {
    ping: () => call("ping"), listApps: () => call("listApps"), install: (path, install) => call("install", [path, install]),
    enable: (id) => call("enable", [id]), disable: (id) => call("disable", [id]), uninstall: (id) => call("uninstall", [id]),
    runNow: (id, triggerId) => call("runNow", [id, triggerId]),
    startRunNow: (id, triggerId, start) => call("startRunNow", [id, triggerId, start]),
    watchRun,
    listRuns: (id) => call("listRuns", [id]), listInbox: (id) => call("listInbox", [id]),
    markInboxRead: (id, ids) => call("markInboxRead", [id, ids]), retryDelivery: (id, notificationId) => call("retryDelivery", [id, notificationId]),
  };
}
