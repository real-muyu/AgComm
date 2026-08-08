export type GatewayServiceOptions = {
    cliPath?: string;
    nodePath?: string;
    homeDir?: string;
    platform?: NodeJS.Platform;
    execute?: (file: string, args: readonly string[]) => Promise<unknown>;
};
export declare function installGatewayAutostart(options?: GatewayServiceOptions): Promise<{
    platform: "darwin";
    path: string;
} | {
    platform: "win32";
    path: string;
} | {
    platform: "linux";
    path: string;
}>;
export declare function uninstallGatewayAutostart(options?: GatewayServiceOptions): Promise<void>;
