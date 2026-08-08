import type { Plugin } from "../../../../../domain/flow/types.ts";
import { assertJsonSchema, assertPluginValue, encodedPluginValueBytes } from "../../../../../runtime/plugins/schema.ts";
import type { PluginValue } from "../../../../../runtime/plugins/sdk.ts";

export function validatePluginResult(plugin: Plugin, operation: string, value: PluginValue) {
  assertPluginValue(value);
  const tool = plugin.tools.find((item) => item.name === operation);
  if (tool?.outputSchema) assertJsonSchema(tool.outputSchema, value);
  if (encodedPluginValueBytes(value) > (plugin.limits?.maxOutputBytes ?? 1_048_576)) throw new Error("Plugin output exceeds size limit");
  return value;
}
