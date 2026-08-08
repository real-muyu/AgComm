import type { Plugin } from "../../../../../domain/flow/types.ts";
import { type PermissionAdapter } from "../contracts/PluginPort.ts";
import type { PluginInvocationRegistry } from "./PluginInvocationRegistry.ts";
import type { PermissionReply } from "./PluginWorkerProtocol.ts";
export declare class PluginPermissionDispatcher {
    private readonly plugin;
    private readonly grants;
    private readonly handlers;
    private readonly invocations;
    private readonly reply;
    constructor(plugin: Plugin, grants: ReadonlySet<string>, handlers: PermissionAdapter, invocations: PluginInvocationRegistry, reply: (message: unknown) => void);
    dispatch(message: PermissionReply): Promise<void>;
}
