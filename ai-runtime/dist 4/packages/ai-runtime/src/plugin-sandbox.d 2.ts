import type { Plugin } from "../../../domain/flow/types.ts";
import type { PluginValue } from "../../../runtime/plugins/sdk.ts";
export declare const RUNTIME_PERMISSIONS: readonly ["filesystem:read", "filesystem:write", "document:read", "document:write", "clipboard:read", "clipboard:write", "screen:read"];
export type RuntimePermission = typeof RUNTIME_PERMISSIONS[number];
export type PermissionHandler = (input: PluginValue, signal: AbortSignal) => Promise<PluginValue> | PluginValue;
export type PermissionAdapter = Partial<Record<RuntimePermission, PermissionHandler>>;
export type PluginLog = {
    pluginId: string;
    level: string;
    message: string;
    details?: PluginValue;
};
export declare class NodePluginSandbox {
    private readonly grants;
    private readonly handlers;
    private readonly onLog?;
    private worker?;
    private loading?;
    private active;
    private readonly pending;
    readonly plugin: Plugin;
    constructor(plugin: Plugin, grants: ReadonlySet<string>, handlers: PermissionAdapter, onLog?: ((log: PluginLog) => void) | undefined);
    private load;
    private tool;
    private handle;
    run(input: PluginValue, signal?: AbortSignal, operation?: string): Promise<PluginValue>;
    private failAll;
    dispose(): Promise<void>;
}
