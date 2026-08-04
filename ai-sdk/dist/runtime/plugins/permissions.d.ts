import type { PluginValue } from "./sdk.ts";
export declare const PERMISSION_PATTERN: RegExp;
export declare class PluginPermissionError extends Error {
    constructor(message: string);
}
export type PermissionHandler = (input: PluginValue, signal: AbortSignal) => Promise<PluginValue> | PluginValue;
export declare function validatePermissionNames(permissions: readonly string[]): string[];
export declare class PluginPermissionBroker {
    private readonly declared;
    private readonly granted;
    private readonly handlers;
    constructor(declared: readonly string[], granted: readonly string[], handlers: Readonly<Record<string, PermissionHandler>>);
    call(permission: string, input: PluginValue, signal: AbortSignal): Promise<PluginValue>;
}
