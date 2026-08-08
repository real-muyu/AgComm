import type { PluginValue } from "../../../../runtime/plugins/sdk.ts";
import { encodedPluginValueBytes } from "../../../../runtime/plugins/schema.ts";
import { AiRuntimeError } from "../errors.ts";
import type { RuntimeEvent } from "../runtime-types.ts";
import { HOOK_RESERVED_VARIABLES, hookRecord, toHookValue } from "./HookValues.ts";
import type { PluginManager } from "./PluginManager.ts";

export class WorkspaceHookContext {
  private readonly states = new Map<string, PluginValue>();
  private localVariables: Record<string, PluginValue>;

  constructor(
    private readonly workspaceId: string,
    readonly hookIds: readonly string[],
    variables: Readonly<Record<string, unknown>>,
    private readonly manager: PluginManager,
    private readonly signal: AbortSignal,
    private readonly emit: (event: RuntimeEvent) => void,
  ) {
    this.localVariables = hookRecord(toHookValue(variables));
    for (const id of hookIds) this.states.set(id, null);
  }

  get variables(): Readonly<Record<string, PluginValue>> {
    return this.localVariables;
  }

  async invoke(hookId: string, operation: string, iteration: number, payload: Record<string, PluginValue>) {
    if (!this.manager.hasHookOperation(hookId, operation)) return {};
    const startedAt = Date.now();
    this.emit({ type: "hook", hookId, workspaceId: this.workspaceId, stage: operation, status: "start" });
    try {
      const event = toHookValue({
        workspaceId: this.workspaceId,
        iteration,
        variables: this.localVariables,
        state: this.states.get(hookId) ?? null,
        ...payload,
      });
      const result = hookRecord(await this.manager.runHook(hookId, operation, event, this.signal));
      this.applyResult(hookId, result);
      this.emit({ type: "hook", hookId, workspaceId: this.workspaceId, stage: operation, status: "complete", elapsedMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      this.emit({ type: "hook", hookId, workspaceId: this.workspaceId, stage: operation, status: "error", elapsedMs: Date.now() - startedAt });
      throw new AiRuntimeError("WORKSPACE_HOOK_FAILED", `Workspace Hook ${hookId}.${operation} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  private applyResult(hookId: string, result: Record<string, PluginValue>) {
    if (Object.hasOwn(result, "state")) {
      const state = result.state ?? null;
      if (encodedPluginValueBytes(state) > 262_144) throw new AiRuntimeError("WORKSPACE_HOOK_STATE_TOO_LARGE", `Workspace Hook ${hookId} state exceeds 256 KiB`);
      this.states.set(hookId, state);
    }
    if (!Object.hasOwn(result, "variables")) return;
    const patch = result.variables;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new AiRuntimeError("WORKSPACE_HOOK_VARIABLES_INVALID", `Workspace Hook ${hookId} variables must be an object`);
    for (const [name, item] of Object.entries(patch)) {
      if (HOOK_RESERVED_VARIABLES.has(name)) throw new AiRuntimeError("WORKSPACE_HOOK_RESERVED_VARIABLE", `Workspace Hook ${hookId} cannot override reserved variable ${name}`);
      this.localVariables[name] = item;
    }
    if (encodedPluginValueBytes(this.localVariables) > 1_048_576) throw new AiRuntimeError("WORKSPACE_HOOK_VARIABLES_TOO_LARGE", "Workspace Hook local variables exceed 1 MiB");
  }
}
