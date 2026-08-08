import type { PluginValue } from "../../../../../runtime/plugins/sdk.ts";
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
