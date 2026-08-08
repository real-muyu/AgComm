export declare function defaultGatewayRoot(): string;
export declare function gatewayIpcEndpoint(root: string): string;
export declare function gatewayIpcToken(root: string, create: boolean): Promise<string>;
