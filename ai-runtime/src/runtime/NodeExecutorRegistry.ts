import { Buffer } from "node:buffer";
import { createSafeOutboundFetch, validateResolvedPublicUrl } from "../../../../lib/network-security.ts";
import type { NodeExecutor } from "../../../../lib/flow-runtime/index.ts";
import type { ExecutorRegistry, RuntimeServices } from "../../../../lib/flow-runtime/types.ts";
import type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
import { AiRuntimeError } from "../errors.ts";
import { renderV3Value, safeText } from "./PluginManager.ts";
import type { FlowExecutionInput } from "./FlowExecutionService.ts";

export function createNodeExecutorRegistry(input: FlowExecutionInput) {
  const { project, context, controller, manager, runSkill, runWorkspace } = input;
  const services: RuntimeServices = { runSkill, runWorkspace, fetch: createSafeOutboundFetch({ maxRedirects: 2, maxResponseBytes: 2_097_152, signal: controller.signal }), allowHttpUrl: async (url) => { await validateResolvedPublicUrl(url, { signal: controller.signal }); return true; }, ...("formatVersion" in project && project.formatVersion >= 3 ? { renderValue: renderV3Value } : {}) };
  const view = (executionContext: any) => ({ ...executionContext.variables, variables: executionContext.variables, previous: { output: executionContext.previous }, inputs: executionContext.inputs });
  const code: NodeExecutor = { async execute(node, executionContext) { const codeId = String(node.config?.codeId ?? "").trim(); if (!codeId) throw new AiRuntimeError("CODE_ID_MISSING", `Code node ${node.id} is missing codeId`); return { output: await manager.runCode(codeId, renderV3Value(node.config?.input, view(executionContext)) as PluginValue, executionContext.signal) }; } };
  const contact: NodeExecutor = { async execute(node, executionContext) { if (!context.background) throw new AiRuntimeError("CONTACT_REQUIRES_GATEWAY", `CONTACT node ${node.id} can only execute through Runtime Gateway`); const values = view(executionContext); const title = safeText(renderV3Value(node.config?.title, values), Number.MAX_SAFE_INTEGER).trim(); const body = safeText(renderV3Value(node.config?.body, values), Number.MAX_SAFE_INTEGER); const severity = node.config?.severity === "warning" || node.config?.severity === "critical" ? node.config.severity : "info"; const dedupeKey = node.config?.dedupeKey === undefined ? undefined : safeText(renderV3Value(node.config.dedupeKey, values), Number.MAX_SAFE_INTEGER).trim(); if (!title || title.length > 120) throw new AiRuntimeError("CONTACT_INVALID", `CONTACT node ${node.id} has an invalid title`); if (Buffer.byteLength(body, "utf8") > 65_536 || (dedupeKey && dedupeKey.length > 256)) throw new AiRuntimeError("CONTACT_INVALID", `CONTACT node ${node.id} payload exceeds limits (body maximum: 64 KiB; dedupe key maximum: 256 characters)`); return { output: await context.background.contact({ nodeId: node.id, title, body, severity, webhook: node.config?.webhook === true, ...(dedupeKey ? { dedupeKey } : {}), trigger: context.background.trigger }) }; } };
  return { services, executors: { CODE: code, CONTACT: contact } as unknown as ExecutorRegistry };
}
