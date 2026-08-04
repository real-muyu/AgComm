import type { PluginTool } from "./plugin.ts";
export type BundleLimits = {
    timeoutMs?: number;
    maxOutputBytes?: number;
    maxConcurrency?: number;
};
export type BundleSchema = {
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
};
export declare function validateBundleDefinition(definition: {
    entry: string;
    id: string;
    name: string;
    description: string;
    version: string;
    permissions?: readonly string[];
}, subject: string): string[];
export declare function createHandlerTools<TOperation extends string>(operations: readonly TOperation[], handlers: Partial<Record<TOperation, unknown>>, schemas: Readonly<Record<TOperation, BundleSchema>>, permissions: readonly string[], subject: string): Record<TOperation, PluginTool>;
