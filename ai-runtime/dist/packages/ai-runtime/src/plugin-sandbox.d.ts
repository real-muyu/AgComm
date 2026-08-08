import type { Plugin } from "../../../domain/flow/types.ts";
import type { PluginValue } from "../../../runtime/plugins/sdk.ts";
import type { PermissionAdapter, PluginLog } from "./runtime/contracts/PluginPort.ts";
export { RUNTIME_PERMISSIONS } from "./runtime/contracts/PluginPort.ts";
export type { PermissionAdapter, PermissionHandler, PluginLog, RuntimePermission } from "./runtime/contracts/PluginPort.ts";
export declare class NodePluginSandbox {
    private readonly grants;
    private readonly handlers;
    private readonly onLog?;
    private worker?;
    private loading?;
    private readonly invocations;
    readonly plugin: Plugin;
    constructor(plugin: Plugin, grants: ReadonlySet<string>, handlers: PermissionAdapter, onLog?: ((log: PluginLog) => void) | undefined);
    private load;
    private tool;
    private handle;
    run(input: PluginValue, signal?: AbortSignal, operation?: string): Promise<PluginValue>;
    dispose(): Promise<void>;
}
