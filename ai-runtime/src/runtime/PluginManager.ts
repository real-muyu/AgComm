import type { WorkspaceExtraTool } from "../../../../lib/workspace-tool-calling.ts";
import type { FlowProject, Plugin, Skill } from "../../../../domain/flow/types.ts";
import { getPath, renderTemplate } from "../../../../lib/flow-runtime/index.ts";
import type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
import { AiRuntimeError } from "../errors.ts";
import { NodePluginSandbox } from "../plugin-sandbox.ts";
import type { PermissionAdapter, PluginLog } from "./contracts/PluginPort.ts";
import type { RuntimeBundleKind, RuntimeEvent, RuntimeTrustProvider } from "../runtime-types.ts";
import { boundedWorkspaceText } from "./WorkspaceExecutor.ts";
import { verifyPlugin } from "./PluginVerification.ts";

const EXACT_REFERENCE = /^\{\{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\}\}$/;

export function renderV3Value(value: unknown, variables: Readonly<Record<string, unknown>>): unknown {
  if (typeof value === "string") {
    const match = EXACT_REFERENCE.exec(value);
    return match ? getPath(variables, match[1]) : renderTemplate(value, variables);
  }
  if (Array.isArray(value)) return value.map((item) => renderV3Value(item, variables));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderV3Value(item, variables)]));
  return value;
}

export const safeText = boundedWorkspaceText;

function pluginToolName(plugin: Plugin, operation: string, index: number) {
  return `plugin_${index + 1}_${plugin.id}_${operation}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

export class PluginManager {
  private readonly sandboxes = new Map<string, NodePluginSandbox>();
  private readonly verified = new Map<string, Promise<{ integrity: string; grants: readonly string[] }>>();

  constructor(
    private readonly project: Pick<FlowProject, "plugins">,
    private readonly trustedKeys: Readonly<Record<string, string>>,
    private readonly grants: Readonly<Record<string, string[]>>,
    private readonly permissions: PermissionAdapter,
    private readonly logs: PluginLog[],
    private readonly allowUnsigned: boolean,
    private readonly packageHash: string,
    private readonly trustProvider: RuntimeTrustProvider | undefined,
    private readonly emit: (event: RuntimeEvent) => void,
  ) {}

  private async sandboxFor(pluginId: string, kind: RuntimeBundleKind) {
    const plugin = this.project.plugins.find((item) => item.id === pluginId);
    if (!plugin) throw new AiRuntimeError("PLUGIN_NOT_FOUND", `Plugin not found: ${pluginId}`);
    let verification = this.verified.get(plugin.id);
    if (!verification) {
      verification = verifyPlugin(plugin, this.trustedKeys, this.allowUnsigned, this.packageHash, kind, this.trustProvider);
      this.verified.set(plugin.id, verification);
    }
    const authorized = await verification;
    const grants = [...new Set([...(this.grants[plugin.id] ?? []), ...authorized.grants])];
    for (const permission of grants) {
      if (!plugin.permissions.includes(permission)) throw new AiRuntimeError("PLUGIN_GRANT_INVALID", `Grant for plugin ${plugin.id} contains undeclared permission ${permission}`);
    }
    let sandbox = this.sandboxes.get(plugin.id);
    if (!sandbox) {
      sandbox = new NodePluginSandbox(plugin, new Set(grants), this.permissions, (log) => {
        this.logs.push(log);
        this.emit({ type: "plugin-log", log });
      });
      this.sandboxes.set(plugin.id, sandbox);
    }
    return { plugin, sandbox };
  }

  async runCode(codeId: string, input: PluginValue, signal: AbortSignal) {
    const { plugin, sandbox } = await this.sandboxFor(codeId, "code");
    const operation = plugin.tools.find((tool) => tool.name === "run");
    if (!operation?.inputSchema || !operation.outputSchema) throw new AiRuntimeError("CODE_SCHEMA_INVALID", `Code ${codeId} must declare input and output schemas`);
    return sandbox.run(input, signal, "run");
  }

  async runHook(hookId: string, operation: string, input: PluginValue, signal: AbortSignal) {
    const plugin = this.project.plugins.find((item) => item.id === hookId);
    if (!plugin) throw new AiRuntimeError("PLUGIN_NOT_FOUND", `Workspace Hook not found: ${hookId}`);
    if ((plugin as Plugin & { kind?: string }).kind !== "workspace-hook") throw new AiRuntimeError("WORKSPACE_HOOK_KIND_INVALID", `Bundle ${hookId} is not a Workspace Hook`);
    if (!plugin.tools.some((tool) => tool.name === operation)) return null;
    const { sandbox } = await this.sandboxFor(hookId, "hook");
    return sandbox.run(input, signal, operation);
  }

  hasHookOperation(hookId: string, operation: string) {
    return this.project.plugins.some((plugin) => plugin.id === hookId && (plugin as Plugin & { kind?: string }).kind === "workspace-hook" && plugin.tools.some((tool) => tool.name === operation));
  }

  async runFlowHook(hookId: string, operation: string, input: PluginValue, signal: AbortSignal) {
    const plugin = this.project.plugins.find((item) => item.id === hookId);
    if (!plugin) throw new AiRuntimeError("PLUGIN_NOT_FOUND", `Flow Hook not found: ${hookId}`);
    if ((plugin as Plugin & { kind?: string }).kind !== "flow-hook") throw new AiRuntimeError("FLOW_HOOK_KIND_INVALID", `Bundle ${hookId} is not a Flow Hook`);
    if (!plugin.tools.some((tool) => tool.name === operation)) return null;
    const { sandbox } = await this.sandboxFor(hookId, "flow-hook");
    return sandbox.run(input, signal, operation);
  }

  hasFlowHookOperation(hookId: string, operation: string) {
    return this.project.plugins.some((plugin) => plugin.id === hookId && (plugin as Plugin & { kind?: string }).kind === "flow-hook" && plugin.tools.some((tool) => tool.name === operation));
  }

  async toolsFor(skill: Skill, signal: AbortSignal): Promise<WorkspaceExtraTool[]> {
    const plugins = skill.pluginIds.map((id) => {
      const plugin = this.project.plugins.find((item) => item.id === id);
      if (!plugin) throw new AiRuntimeError("PLUGIN_NOT_FOUND", `Skill ${skill.id} references missing plugin ${id}`);
      return plugin;
    });
    const tools: WorkspaceExtraTool[] = [];
    let index = 0;
    for (const plugin of plugins) {
      const { sandbox } = await this.sandboxFor(plugin.id, "plugin");
      for (const operation of plugin.tools) {
        const name = pluginToolName(plugin, operation.name, index++);
        tools.push({
          id: `${plugin.id}:${operation.name}`,
          label: `${plugin.name} · ${operation.name}`,
          name,
          tool: {
            type: "function",
            function: {
              name,
              description: operation.description.slice(0, 500),
              parameters: operation.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
            },
          },
          call: async (args) => {
            if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
            const result = await sandbox.run(args as PluginValue, signal, operation.name);
            return typeof result === "string" ? result : JSON.stringify(result);
          },
        });
      }
    }
    return tools;
  }

  async dispose() {
    await Promise.all([...this.sandboxes.values()].map((sandbox) => sandbox.dispose()));
    this.sandboxes.clear();
  }
}
