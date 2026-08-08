import type { Plugin } from "../../../../../domain/flow/types.ts";
import type { PluginInvocationRegistry } from "./PluginInvocationRegistry.ts";
import type { ResultReply } from "./PluginWorkerProtocol.ts";
import { validatePluginResult } from "./PluginResultValidator.ts";

export class PluginResultDispatcher {
  constructor(private readonly plugin: Plugin, private readonly invocations: PluginInvocationRegistry) {}

  dispatch(message: ResultReply) {
    const pending = this.invocations.take(message.id);
    if (!pending) return;
    if (message.error) { pending.reject(new Error(message.error)); return; }
    try {
      pending.resolve(validatePluginResult(this.plugin, pending.operation, message.result ?? null));
    } catch (error) {
      pending.reject(error);
    }
  }
}
