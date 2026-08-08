export class RuntimeLifecycle {
  readonly controllers = new Set<AbortController>();
  async dispose(disposers: readonly (() => Promise<void>)[]) { for (const controller of this.controllers) controller.abort(new DOMException("Runtime disposed", "AbortError")); await Promise.all(disposers.map((dispose) => dispose())); this.controllers.clear(); }
}
