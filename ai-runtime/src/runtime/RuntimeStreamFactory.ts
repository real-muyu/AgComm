import { createAiRunStream } from "./StreamPublisher.ts";
import type { ProjectExecutionContext, RuntimeProject } from "./ProjectExecutor.ts";
import type { AiRunResult, AiRunStream, AiStreamEvent, StreamRunOptions } from "../runtime-types.ts";

export function createRuntimeStreamFactory(execute: (project: RuntimeProject, options: StreamRunOptions, context: ProjectExecutionContext) => Promise<AiRunResult>) {
  return (project: RuntimeProject, streamOptions: StreamRunOptions = {}, context: ProjectExecutionContext): AiRunStream<string | AiStreamEvent> => {
    const { mode: requestedMode, signal: externalSignal, onStreamEvent, onOutputDelta, ...runOptions } = streamOptions;
    const mode = requestedMode ?? project.interaction?.streaming?.defaultMode ?? "text";
    return createAiRunStream<string | AiStreamEvent>(
      (signal, push) => execute(project, { ...runOptions, signal, mode, onStreamEvent(event) { onStreamEvent?.(event); if (mode === "events") push(event); }, onOutputDelta(text) { onOutputDelta?.(text); if (mode === "text") push(text); } }, context),
      { externalSignal, closeOnError: mode === "events" },
    );
  };
}
