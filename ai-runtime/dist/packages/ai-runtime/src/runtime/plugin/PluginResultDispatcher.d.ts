import type { Plugin } from "../../../../../domain/flow/types.ts";
import type { PluginInvocationRegistry } from "./PluginInvocationRegistry.ts";
import type { ResultReply } from "./PluginWorkerProtocol.ts";
export declare class PluginResultDispatcher {
    private readonly plugin;
    private readonly invocations;
    constructor(plugin: Plugin, invocations: PluginInvocationRegistry);
    dispatch(message: ResultReply): void;
}
