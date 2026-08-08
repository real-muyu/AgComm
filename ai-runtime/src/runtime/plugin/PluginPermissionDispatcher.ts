import type { Plugin } from "../../../../../domain/flow/types.ts";
import { assertPluginValue } from "../../../../../runtime/plugins/schema.ts";
import { RUNTIME_PERMISSIONS, type PermissionAdapter, type RuntimePermission } from "../contracts/PluginPort.ts";
import type { PluginInvocationRegistry } from "./PluginInvocationRegistry.ts";
import type { PermissionReply } from "./PluginWorkerProtocol.ts";

export class PluginPermissionDispatcher {
  constructor(
    private readonly plugin: Plugin,
    private readonly grants: ReadonlySet<string>,
    private readonly handlers: PermissionAdapter,
    private readonly invocations: PluginInvocationRegistry,
    private readonly reply: (message: unknown) => void,
  ) {}

  async dispatch(message: PermissionReply) {
    try {
      const invocation = this.invocations.get(message.runId);
      const tool = invocation && this.plugin.tools.find((item) => item.name === invocation.operation);
      if (!invocation || !tool) throw new Error("Plugin invocation context expired");
      const permission = message.permission as RuntimePermission;
      if (!this.plugin.permissions.includes(message.permission)) throw new Error(`Plugin did not declare permission: ${message.permission}`);
      if (!tool.permissions.includes(message.permission)) throw new Error(`Plugin tool did not declare permission: ${message.permission}`);
      if (!this.grants.has(message.permission)) throw new Error(`Plugin permission was not granted: ${message.permission}`);
      if (!RUNTIME_PERMISSIONS.includes(permission)) throw new Error(`Unknown Runtime permission: ${message.permission}`);
      const handler = this.handlers[permission];
      if (!handler) throw new Error(`Host does not implement permission: ${message.permission}`);
      if (invocation.signal.aborted) throw invocation.signal.reason ?? new DOMException("Aborted", "AbortError");
      const result = await handler(message.input, invocation.signal);
      assertPluginValue(result);
      this.reply({ type: "permission-result", id: message.id, result });
    } catch (error) {
      this.reply({ type: "permission-result", id: message.id, error: error instanceof Error ? error.message : "Permission denied" });
    }
  }
}
