import type { Plugin } from "../../../../../domain/flow/types.ts";
import type { PluginValue } from "../../../../../runtime/plugins/sdk.ts";
export declare function validatePluginResult(plugin: Plugin, operation: string, value: PluginValue): PluginValue;
