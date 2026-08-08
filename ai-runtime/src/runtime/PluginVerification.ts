import { computeBundleIntegrity, verifyBundleIntegrity, verifyPluginSignature } from "../../../../lib/plugin-runtime/signature.ts";
import type { SignedPluginManifest } from "../../../../lib/plugin-runtime/types.ts";
import type { Plugin } from "../../../../domain/flow/types.ts";
import { AiRuntimeError } from "../errors.ts";
import type { RuntimeBundleKind, RuntimeTrustProvider } from "../runtime-types.ts";

async function normalizedPluginIntegrity(plugin: Plugin) {
  if (!plugin.integrity) return computeBundleIntegrity(plugin.bundleCode);
  if (!await verifyBundleIntegrity(plugin.bundleCode, plugin.integrity)) {
    throw new AiRuntimeError("PLUGIN_INTEGRITY_INVALID", `Plugin ${plugin.id} bundle integrity verification failed`);
  }
  return plugin.integrity;
}

export async function verifyPlugin(
  plugin: Plugin,
  trustedKeys: Readonly<Record<string, string>>,
  allowUnsigned: boolean,
  packageHash: string,
  kind: RuntimeBundleKind,
  trustProvider?: RuntimeTrustProvider,
) {
  if (plugin.runtime !== "player" && plugin.runtime !== "runtime") throw new AiRuntimeError("PLUGIN_RUNTIME_UNSUPPORTED", `Plugin ${plugin.id} is not a portable Runtime bundle`);
  const integrity = await normalizedPluginIntegrity(plugin);
  if (!plugin.signature) {
    const decision = trustProvider ? await trustProvider.authorize({ packageHash, bundleId: plugin.id, kind, name: plugin.name, version: plugin.version, integrity, permissions: plugin.permissions }) : undefined;
    if (trustProvider ? (!decision?.trusted || decision.allowUnsigned !== true) : !allowUnsigned) throw new AiRuntimeError("PLUGIN_UNSIGNED", `Plugin ${plugin.id} is unsigned`);
    return { integrity, grants: decision?.grants ?? [] };
  }
  const manifest = JSON.parse(JSON.stringify({
    id: plugin.id, name: plugin.name, description: plugin.description, version: plugin.version,
    sdkVersion: plugin.sdkVersion, language: plugin.language, entry: plugin.entry, runtime: plugin.runtime,
    source: plugin.source,
    ...(typeof (plugin as Plugin & { kind?: unknown }).kind === "string" ? { kind: (plugin as Plugin & { kind: "plugin" | "code" | "workspace-hook" | "flow-hook" }).kind } : {}),
    author: plugin.author, license: plugin.license, homepage: plugin.homepage,
    permissions: plugin.permissions, tools: plugin.tools, limits: plugin.limits, integrity, signature: plugin.signature,
  })) as SignedPluginManifest;
  if (!trustedKeys[plugin.signature.keyId]) throw new AiRuntimeError("PLUGIN_PUBLISHER_UNKNOWN", `Plugin ${plugin.id} publisher is not trusted`);
  if (!await verifyPluginSignature(manifest, trustedKeys)) throw new AiRuntimeError("PLUGIN_SIGNATURE_INVALID", `Plugin ${plugin.id} signature verification failed`);
  const decision = trustProvider ? await trustProvider.authorize({ packageHash, bundleId: plugin.id, kind, name: plugin.name, version: plugin.version, integrity, permissions: plugin.permissions, signature: plugin.signature }) : undefined;
  if (decision && !decision.trusted) throw new AiRuntimeError("PLUGIN_TRUST_DENIED", `Trust was denied for Plugin ${plugin.id}`);
  return { integrity, grants: decision?.grants ?? [] };
}
