import type { GatewayClientLike } from "../gateway-loader.ts";
export type GatewayInboxItem = Awaited<ReturnType<GatewayClientLike["listInbox"]>>[number];
export declare class GatewayInboxState {
    #private;
    get current(): GatewayInboxItem | undefined;
    update(items: GatewayInboxItem[]): void;
    move(offset: number): void;
    lines(): string[];
}
