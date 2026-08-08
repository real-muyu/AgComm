import type { WorkspaceToolDefinition } from "../../../../lib/workspace-tool-calling.ts";
import type { RuntimeRenderer } from "../renderer.ts";
import type { ModelEvent, ModelProvider } from "./contracts/ModelPort.ts";
import type { ModelInvocationContext, RunAiOptions } from "../runtime-types.ts";
import type { OutputStreamCoordinator, StreamPublisher } from "./StreamPublisher.ts";

export function createModelInvocationService(input: {
  provider: ModelProvider;
  runOptions: RunAiOptions;
  renderer?: RuntimeRenderer;
  outputStream?: OutputStreamCoordinator;
  publisher: StreamPublisher;
}) {
  return async (
    messages: unknown[],
    tools: WorkspaceToolDefinition[],
    forceFinal: boolean,
    signal: AbortSignal,
    invocation: Omit<ModelInvocationContext, "callId" | "forceFinal">,
  ) => {
    const context: ModelInvocationContext = { ...invocation, callId: crypto.randomUUID(), forceFinal };
    input.outputStream?.beginModel(context);
    input.publisher.publish({ type: "model-start", context });
    const onEvent = input.runOptions.onModelEvent || input.renderer?.onModelEvent
      || input.runOptions.onStreamEvent || input.renderer?.onStreamEvent || input.runOptions.onOutputDelta
      ? (event: ModelEvent) => {
          input.runOptions.onModelEvent?.(event);
          input.renderer?.onModelEvent?.(event);
          input.outputStream?.modelEvent(context, event);
          input.publisher.publish({ type: "model-event", context, event });
        }
      : undefined;
    const reply = await input.provider.call({ messages, tools, forceFinal, signal, onEvent });
    input.outputStream?.completeModel(context, reply);
    input.publisher.publish({
      type: "model-complete",
      context,
      hasToolCalls: Boolean(reply.toolCalls?.length),
      contentLength: reply.content.length,
    });
    return reply;
  };
}
