export { createGatewayCredentialStore, createRuntimeGateway, RuntimeGateway } from "./gateway.ts";
export type { GatewayAppSummary, GatewayCredentialStore, GatewayDelivery, GatewayInboxItem, GatewayInstallOptions, GatewayRunRecord, GatewayRunStream, GatewayRunTicket, GatewayStartRunOptions, GatewayStreamFrame, NotificationAdapter, NotificationAdapterContext, RuntimeGatewayOptions, } from "./gateway.ts";
export { connectRuntimeGateway } from "./gateway-ipc.ts";
export type { RuntimeGatewayClient } from "./gateway-ipc.ts";
export { installGatewayAutostart, uninstallGatewayAutostart } from "./gateway-service.ts";
export type { GatewayServiceOptions } from "./gateway-service.ts";
export type { BackgroundTriggerContext, ContactReceipt, ContactRequest } from "@agcomm/ai-runtime/gateway-host";
