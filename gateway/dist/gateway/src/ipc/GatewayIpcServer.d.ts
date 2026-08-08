import type { RuntimeGateway } from "../gateway/RuntimeGateway.ts";
export declare function createGatewayIpcServer(gateway: RuntimeGateway, root: string): Promise<{
    close(): Promise<void>;
}>;
