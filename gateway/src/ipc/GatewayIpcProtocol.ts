// SPDX-License-Identifier: Elastic-2.0
import type { GatewayRunRecord, GatewayStreamFrame } from "../gateway/RuntimeGateway.ts";

export type GatewayIpcRequest = { token: string; operation: string; args?: unknown[] };
export type GatewayIpcResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };
export type GatewayIpcStreamResponse =
  | GatewayIpcResponse
  | { stream: true; frame: GatewayStreamFrame }
  | { done: true; record: GatewayRunRecord };
