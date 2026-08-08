import type { AiAppInfo } from "../runtime-types.ts";
import type { RuntimeFormatVersion, RuntimeProject } from "./PackageParser.ts";

export function createRuntimeAppInfo(project: RuntimeProject, formatVersion: RuntimeFormatVersion, packageHash: string): AiAppInfo {
  const codeIds = new Set(project.nodes.filter((node) => node.type === "CODE").map((node) => String(node.config?.codeId ?? "")));
  const hookIds = new Set(project.nodes.filter((node) => node.type === "WORKSPACE").flatMap((node) => Array.isArray(node.config?.hookIds) ? node.config.hookIds.map(String) : []));
  const flowHookIds = new Set(project.flowHookIds ?? []);
  return Object.freeze({
    formatVersion,
    packageHash,
    nodes: Object.freeze(project.nodes.map((node) => Object.freeze({ id: node.id, title: node.title, type: node.type }))),
    bundles: Object.freeze(project.plugins.filter((plugin) => plugin.runtime === "player" || plugin.runtime === "runtime").map((plugin) => Object.freeze({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      kind: flowHookIds.has(plugin.id) ? "flow-hook" as const : hookIds.has(plugin.id) ? "hook" as const : codeIds.has(plugin.id) ? "code" as const : "plugin" as const,
      runtime: plugin.runtime as "player" | "runtime",
      permissions: Object.freeze([...plugin.permissions]),
      signed: Boolean(plugin.signature),
    }))),
    ...(project.background && project.appId && project.appVersion ? { background: Object.freeze({
      appId: project.appId,
      version: project.appVersion,
      triggerCount: Number(Boolean(project.background.heartbeat)) + (project.background.cron?.length ?? 0),
      contactCount: project.nodes.filter((node) => node.type === "CONTACT").length,
      requiresWebhook: project.nodes.some((node) => node.type === "CONTACT" && node.config?.webhook === true),
      triggers: Object.freeze([
        ...(project.background.heartbeat ? [{ id: project.background.heartbeat.id, type: "heartbeat" as const, schedule: `every ${project.background.heartbeat.everyMs}ms` }] : []),
        ...(project.background.cron ?? []).map((trigger) => ({ id: trigger.id, type: "cron" as const, schedule: `${trigger.expression} (${trigger.timezone})` })),
      ]),
    }) } : {}),
  });
}
