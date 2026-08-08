import { type GatewayAppSummary, type GatewayInboxItem, type NotificationAdapter } from "./GatewayState.ts";
export type GatewayDeliveryPort = {
    apps: readonly GatewayAppSummary[];
    adapters: ReadonlyMap<string, NotificationAdapter>;
    now(): Date;
    statePath(id: string, name: string): string;
    withLock<T>(key: string, action: () => Promise<T>): Promise<T>;
    deliverWebhook(app: GatewayAppSummary, item: GatewayInboxItem, signal: AbortSignal): Promise<void>;
};
export declare function deliverPendingNotifications(port: GatewayDeliveryPort): Promise<void>;
