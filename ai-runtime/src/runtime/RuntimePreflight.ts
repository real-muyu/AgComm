import type { PermissionAdapter } from "../plugin-sandbox.ts";
import { AiRuntimeError } from "../errors.ts";
import { verifyPlugin } from "./PluginVerification.ts";
import type { RuntimeProject } from "./ProjectExecutor.ts";
import type { ProviderConfig } from "./contracts/ModelPort.ts";
import type { RuntimeBundleKind, RuntimeOptions } from "../runtime-types.ts";

function assertProviderAvailable(project: RuntimeProject, config: ProviderConfig, injected: boolean) {
  const usesModel = project.nodes.some((node) => node.type === "SKILL" || node.type === "WORKSPACE");
  if (usesModel && !injected && !(config.apiKey ?? process.env.OPENAI_API_KEY)) throw new AiRuntimeError("MISSING_API_KEY", "A configured Provider is required before enabling this background app");
}

function bundleKinds(project: RuntimeProject) {
  const codeIds = new Set(project.nodes.filter((node) => node.type === "CODE").map((node) => String(node.config?.codeId ?? "")));
  const hookIds = new Set(project.nodes.filter((node) => node.type === "WORKSPACE").flatMap((node) => Array.isArray(node.config?.hookIds) ? node.config.hookIds.map(String) : []));
  const flowHookIds = new Set(project.flowHookIds ?? []);
  return (id: string): RuntimeBundleKind => flowHookIds.has(id) ? "flow-hook" : hookIds.has(id) ? "hook" : codeIds.has(id) ? "code" : "plugin";
}

async function preflightBundle(plugin: RuntimeProject["plugins"][number], kind: RuntimeBundleKind, packageHash: string, options: RuntimeOptions) {
  const verified = await verifyPlugin(plugin, options.trustedKeys ?? {}, options.allowUnsignedPlugins === true, packageHash, kind, options.trustProvider);
  const grants = new Set([...(options.grants?.[plugin.id] ?? []), ...verified.grants]);
  for (const permission of plugin.permissions) {
    if (!grants.has(permission)) throw new AiRuntimeError("PLUGIN_PERMISSION_NOT_GRANTED", `Background bundle ${plugin.id} requires an explicit grant for ${permission}`);
    if (!(options.permissions?.[permission as keyof PermissionAdapter])) throw new AiRuntimeError("PLUGIN_PERMISSION_UNAVAILABLE", `Background bundle ${plugin.id} requires unavailable host permission ${permission}`);
  }
}

export function createRuntimePreflight(options: RuntimeOptions, config: ProviderConfig, hasInjectedProvider: boolean) {
  return async (project: RuntimeProject, packageHash: string) => {
    assertProviderAvailable(project, config, hasInjectedProvider);
    const kindFor = bundleKinds(project);
    for (const plugin of project.plugins.filter((item) => item.runtime === "player" || item.runtime === "runtime")) {
      await preflightBundle(plugin, kindFor(plugin.id), packageHash, options);
    }
  };
}
