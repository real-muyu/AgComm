// ../../runtime/plugins/sdk.ts
var PLUGIN_SDK_VERSION = "1";
var PluginError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PluginError";
    this.code = code;
  }
};
var PluginAbortError = class extends PluginError {
  constructor(message = "Plugin execution aborted") {
    super("ABORTED", message);
    this.name = "PluginAbortError";
  }
};
function definePlugin(plugin) {
  if (typeof plugin.run !== "function" && (!plugin.tools || !Object.keys(plugin.tools).length)) throw new PluginError("INVALID_PLUGIN", "Plugin must define run() or at least one tool");
  return plugin;
}
function defineTool(tool) {
  return tool;
}
export {
  PLUGIN_SDK_VERSION,
  PluginAbortError,
  PluginError,
  definePlugin,
  defineTool
};
