import type { RuntimeGateway } from "../gateway/RuntimeGateway.ts";
import type { GatewayIpcRequest, GatewayIpcResponse } from "./GatewayIpcProtocol.ts";
export declare function gatewayIpcFailure(error: unknown): GatewayIpcResponse;
export declare function dispatchGatewayIpc(gateway: RuntimeGateway, request: GatewayIpcRequest): Promise<unknown>;
