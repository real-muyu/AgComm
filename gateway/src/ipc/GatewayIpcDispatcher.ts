// SPDX-License-Identifier: Elastic-2.0
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";
import type { GatewayInstallOptions, GatewayStartRunOptions, RuntimeGateway } from "../gateway/RuntimeGateway.ts";
import type { GatewayIpcRequest, GatewayIpcResponse } from "./GatewayIpcProtocol.ts";

export function gatewayIpcFailure(error: unknown): GatewayIpcResponse {
  return {
    ok: false,
    error: {
      code: error instanceof AiRuntimeError ? error.code : "GATEWAY_REQUEST_FAILED",
      message: (error instanceof Error ? error.message : String(error)).slice(0, 4_096),
    },
  };
}

export async function dispatchGatewayIpc(gateway: RuntimeGateway, request: GatewayIpcRequest): Promise<unknown> {
  const args = request.args ?? [];
  switch (request.operation) {
    case "ping": return gateway.status();
    case "listApps": return gateway.listApps();
    case "install": return gateway.install(String(args[0]), (args[1] ?? {}) as GatewayInstallOptions);
    case "enable": return gateway.enable(String(args[0]));
    case "disable": return gateway.disable(String(args[0]));
    case "uninstall": return gateway.uninstall(String(args[0]));
    case "runNow": return gateway.runNow(String(args[0]), String(args[1]));
    case "startRunNow": return gateway.startRunNow(String(args[0]), String(args[1]), (args[2] ?? {}) as GatewayStartRunOptions);
    case "listRuns": return gateway.listRuns(String(args[0]));
    case "listInbox": return gateway.listInbox(String(args[0]));
    case "markInboxRead": return gateway.markInboxRead(String(args[0]), Array.isArray(args[1]) ? args[1].map(String) : []);
    case "retryDelivery": return gateway.retryDelivery(String(args[0]), String(args[1]));
    default: throw new AiRuntimeError("GATEWAY_OPERATION_INVALID", `Unknown Gateway operation: ${request.operation}`);
  }
}
