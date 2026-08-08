import type { AiRunResult } from "../runtime-types.ts";
import type { ModelProvider, ProviderConfig } from "./contracts/ModelPort.ts";

export class RendererLifecycle {
  constructor(private readonly renderer: any, private readonly controller: AbortController, private readonly provider: ModelProvider, private readonly config: ProviderConfig) {}
  model() { return this.provider.model ?? this.config.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini"; }
  async start(projectName: string) { await this.renderer?.start?.({ projectName, model: this.model(), signal: this.controller.signal, cancel: (reason: unknown) => { if (!this.controller.signal.aborted) this.controller.abort(reason ?? new DOMException("Interrupted", "AbortError")); } }); }
  async complete(result: AiRunResult) { await this.renderer?.complete?.(result); }
  async fail(error: unknown) { return settleRendererCleanup(() => this.renderer?.fail?.(error)); }
  async dispose() { return settleRendererCleanup(() => this.renderer?.dispose?.()); }
}

async function settleRendererCleanup(action: () => unknown): Promise<unknown | undefined> {
  return Promise.resolve().then(action).then(() => undefined, (error) => error);
}
