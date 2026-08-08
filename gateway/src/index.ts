// SPDX-License-Identifier: Elastic-2.0
export { createGatewayCredentialStore, RuntimeGateway } from "./gateway/RuntimeGateway.ts";
export { createRuntimeGateway } from "./gateway/GatewayComposition.ts";
export type {
  GatewayAppSummary,
  GatewayCredentialStore,
  GatewayDelivery,
  GatewayInboxItem,
  GatewayInstallOptions,
  GatewayRunRecord,
  GatewayRunStream,
  GatewayRunTicket,
  GatewayStartRunOptions,
  GatewayStreamFrame,
  NotificationAdapter,
  NotificationAdapterContext,
  RuntimeGatewayOptions,
} from "./gateway/RuntimeGateway.ts";
export { connectRuntimeGateway } from "./ipc/GatewayIpcClient.ts";
export type { RuntimeGatewayClient } from "./ipc/GatewayIpcClient.ts";
export { installGatewayAutostart, uninstallGatewayAutostart } from "./gateway-service.ts";
export type { GatewayServiceOptions } from "./gateway-service.ts";
export type { BackgroundTriggerContext, ContactReceipt, ContactRequest } from "@agcomm/ai-runtime/gateway-host";
