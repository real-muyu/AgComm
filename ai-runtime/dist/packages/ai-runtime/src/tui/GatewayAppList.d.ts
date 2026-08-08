import type { GatewayClientLike } from "../gateway-loader.ts";
export type GatewayApp = Awaited<ReturnType<GatewayClientLike["listApps"]>>[number];
export declare function gatewayAppLines(apps: readonly GatewayApp[], selected: number): string[];
