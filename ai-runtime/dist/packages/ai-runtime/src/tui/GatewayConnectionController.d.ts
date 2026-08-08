import { type GatewayClientLike } from "../gateway-loader.ts";
export type GatewayConnectionOptions = {
    gateway?: GatewayClientLike;
    installService?: () => Promise<unknown>;
};
export declare class GatewayConnectionController {
    private readonly options;
    constructor(options: GatewayConnectionOptions);
    ensure(): Promise<GatewayClientLike>;
    connected(): Promise<GatewayClientLike>;
    private waitForService;
    private tryHealthyClient;
    private assertHealthy;
}
