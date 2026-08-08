import type { PluginValue } from "../../../../../runtime/plugins/sdk.ts";

export type PendingPluginInvocation = {
  operation: string;
  signal: AbortSignal;
  resolve(value: PluginValue): void;
  reject(error: unknown): void;
};

export class PluginInvocationRegistry {
  private readonly invocations = new Map<string, PendingPluginInvocation>();

  get size() { return this.invocations.size; }
  get(id: string) { return this.invocations.get(id); }
  add(id: string, invocation: PendingPluginInvocation) { this.invocations.set(id, invocation); }
  remove(id: string) { return this.invocations.delete(id); }
  take(id: string) {
    const invocation = this.invocations.get(id);
    if (invocation) this.invocations.delete(id);
    return invocation;
  }
  failAll(error: Error) {
    for (const invocation of this.invocations.values()) invocation.reject(error);
    this.invocations.clear();
  }
}
