import { AiRuntimeError } from "../errors.ts";
import type { RuntimeRenderer } from "../renderer.ts";
import type { AiStreamEvent, AiStreamEventInput, RunAiOptions, RuntimeEvent } from "../runtime-types.ts";

export { createAiRunStream, OutputStreamCoordinator, streamError } from "../streaming.ts";

export class StreamPublisher {
  private sequence = 0;
  private callbackEnabled = true;

  constructor(
    private readonly options: RunAiOptions,
    private readonly renderer?: RuntimeRenderer,
  ) {}

  publish(value: AiStreamEventInput): void {
    if (!this.callbackEnabled && !this.renderer?.onStreamEvent) return;
    const event = { ...value, sequence: ++this.sequence, at: new Date().toISOString() } as AiStreamEvent;
    try {
      if (this.callbackEnabled) this.options.onStreamEvent?.(event);
      this.renderer?.onStreamEvent?.(event);
    } catch (error) {
      this.callbackEnabled = false;
      throw callbackFailure("Stream event callback failed", error);
    }
  }

  output(text: string, nodeId?: string): void {
    if (!text) return;
    try {
      this.options.onOutputDelta?.(text);
    } catch (error) {
      this.callbackEnabled = false;
      throw callbackFailure("Output delta callback failed", error);
    }
    this.publish({ type: "output-delta", text, ...(nodeId ? { nodeId } : {}) });
  }

  runtime(event: RuntimeEvent): void {
    this.options.onRuntimeEvent?.(event);
    this.renderer?.onRuntimeEvent?.(event);
    this.publish({ type: "runtime-event", event });
  }
}

function callbackFailure(message: string, error: unknown): unknown {
  if (error instanceof AiRuntimeError
    && (error.code === "STREAM_BACKPRESSURE_EXCEEDED" || error.code === "GATEWAY_STREAM_LIMIT_EXCEEDED")) {
    return error;
  }
  return new AiRuntimeError("STREAM_CALLBACK_FAILED", message, { cause: error });
}
