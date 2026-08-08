import type { PluginValue } from "../../../../../runtime/plugins/sdk.ts";
export type PendingPluginInvocation = {
    operation: string;
    signal: AbortSignal;
    resolve(value: PluginValue): void;
    reject(error: unknown): void;
};
export declare class PluginInvocationRegistry {
    private readonly invocations;
    get size(): number;
    get(id: string): PendingPluginInvocation | undefined;
    add(id: string, invocation: PendingPluginInvocation): void;
    remove(id: string): boolean;
    take(id: string): PendingPluginInvocation | undefined;
    failAll(error: Error): void;
}
