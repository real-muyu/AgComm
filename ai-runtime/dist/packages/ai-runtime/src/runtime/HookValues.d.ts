import type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
export declare const HOOK_RESERVED_VARIABLES: Set<string>;
export type HookTool = {
    id: string;
    name: string;
    kind: "skill" | "plugin";
};
export declare function toHookValue(value: unknown): PluginValue;
export declare function hookRecord(value: PluginValue): Record<string, PluginValue>;
export declare function normalizedHookMessage(value: unknown): {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    toolCallId?: string;
};
