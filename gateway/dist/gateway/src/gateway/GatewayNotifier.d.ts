import { type ContactReceipt, type ContactRequest } from "@agcomm/ai-runtime/gateway-host";
import { type GatewayAppSummary, type GatewayCredentialStore, type GatewayInboxItem, type GatewayState, type NotificationAdapter } from "./GatewayState.ts";
export declare function createGatewayCredentialStore(): GatewayCredentialStore;
/** Owns credential selection and notification adapter registration. */
export declare class GatewayNotifier {
    readonly credentials: GatewayCredentialStore;
    private readonly state?;
    private readonly now;
    private readonly fetcher?;
    readonly adapters: Map<string, NotificationAdapter>;
    constructor(credentials: GatewayCredentialStore, adapters: readonly NotificationAdapter[], state?: GatewayState | undefined, now?: () => Date, fetcher?: typeof globalThis.fetch | undefined);
    private requireState;
    listInbox(id: string): Promise<GatewayInboxItem[]>;
    markRead(id: string, notificationIds: readonly string[]): Promise<void>;
    retry(id: string, notificationId: string): Promise<void>;
    recordContact(app: GatewayAppSummary, request: ContactRequest): Promise<ContactReceipt>;
    deliverWebhook(app: GatewayAppSummary, item: GatewayInboxItem, signal: AbortSignal): Promise<void>;
    deliverPending(): Promise<void>;
}
