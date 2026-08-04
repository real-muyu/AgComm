export declare const PLUGIN_SDK_VERSION: "1";
export type PluginValue = null | boolean | number | string | PluginValue[] | {
    [key: string]: PluginValue;
};
export type PluginContext = {
    readonly pluginId: string;
    readonly signal: AbortSignal;
    call<TOutput extends PluginValue = PluginValue>(permission: string, input?: PluginValue): Promise<TOutput>;
    log(level: "debug" | "info" | "warn" | "error", message: string, details?: PluginValue): void;
    checkAborted(): void;
};
export declare class PluginError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class PluginAbortError extends PluginError {
    constructor(message?: string);
}
export type PluginTool<TInput extends PluginValue = PluginValue, TOutput extends PluginValue = PluginValue> = {
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    permissions?: string[];
    run(input: TInput, context: PluginContext): Promise<TOutput> | TOutput;
};
export type AgentPlugin<TInput extends PluginValue = PluginValue, TOutput extends PluginValue = PluginValue> = {
    run?(input: TInput, context: PluginContext): Promise<TOutput> | TOutput;
    tools?: Record<string, PluginTool>;
    dispose?(): Promise<void> | void;
};
export type PortablePluginDefinition = AgentPlugin & {
    entry: string;
    id: string;
    name: string;
    description?: string;
    version: string;
    author?: {
        name: string;
        url?: string;
    };
    license?: string;
    homepage?: string;
    permissions?: string[];
    limits?: {
        timeoutMs?: number;
        maxOutputBytes?: number;
        maxConcurrency?: number;
    };
    readme?: string;
    tools: Record<string, PluginTool>;
};
export declare function definePlugin<TPlugin extends AgentPlugin>(plugin: TPlugin): TPlugin;
export declare function definePlugin<TInput extends PluginValue, TOutput extends PluginValue>(plugin: AgentPlugin<TInput, TOutput>): AgentPlugin<TInput, TOutput>;
export declare function defineTool<TInput extends PluginValue, TOutput extends PluginValue, TTool extends PluginTool<TInput, TOutput> = PluginTool<TInput, TOutput>>(tool: TTool): TTool;
