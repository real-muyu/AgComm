import type { PluginValue } from "./sdk.ts";
export declare class PluginSchemaError extends Error {
    readonly path: string;
    constructor(message: string, path?: string);
}
export declare function assertJsonSchemaDefinition(schema: Record<string, unknown>, path?: string, depth?: number): void;
export declare function assertPluginValue(value: unknown, path?: string, depth?: number): asserts value is PluginValue;
export declare function assertJsonSchema(schema: Record<string, unknown>, value: unknown, path?: string, depth?: number): void;
export declare function encodedPluginValueBytes(value: unknown): number;
