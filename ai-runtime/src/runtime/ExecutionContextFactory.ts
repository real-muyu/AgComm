import { compileRuntimeVariables } from "../../../../domain/flow/compiler.ts";
import type { FlowProject } from "../../../../domain/flow/types.ts";
import type { WorkspaceToolTrace } from "../../../../lib/workspace-tool-calling.ts";
import type { PluginLog } from "./contracts/PluginPort.ts";
import type { RunAiOptions } from "../runtime-types.ts";
import { OutputStreamCoordinator, StreamPublisher } from "./StreamPublisher.ts";
import type { RuntimeProject } from "./PackageParser.ts";
import type { ProjectExecutionContext } from "./ProjectExecutor.ts";

export function createExecutionContext(project: RuntimeProject, runOptions: RunAiOptions, context: ProjectExecutionContext) {
  const controller = new AbortController(); const cancel = () => controller.abort(runOptions.signal?.reason ?? new DOMException("Run aborted", "AbortError")); if (runOptions.signal?.aborted) cancel(); else runOptions.signal?.addEventListener("abort", cancel, { once: true });
  const renderer = runOptions.renderer || undefined; const publisher = new StreamPublisher(runOptions, renderer); const outputStream = runOptions.onStreamEvent || runOptions.onOutputDelta || renderer?.onStreamEvent ? new OutputStreamCoordinator(project as unknown as FlowProject, (text, nodeId) => publisher.output(text, nodeId)) : undefined;
  const history = [...(context.history ?? [])]; const knowledgeContext = context.knowledgeContext ?? ""; const variables = compileRuntimeVariables(project as unknown as FlowProject, { ...(runOptions.variables ?? {}), ...(runOptions.input === undefined ? {} : { user_input: runOptions.input }), session_id: context.sessionId ?? "", conversation_history: history.map(({ role, content }) => ({ role, content })), knowledge_context: knowledgeContext, background_trigger: context.background?.trigger ?? { type: "manual" }, gateway_run_id: context.background?.trigger.runId ?? "" });
  return { startedAt: Date.now(), controller, cancel, renderer, publisher, outputStream, history, knowledgeContext, variables, logs: [] as PluginLog[], toolCalls: [] as WorkspaceToolTrace[], streamMode: runOptions.mode ?? project.interaction?.streaming?.defaultMode ?? "text", emit: (event: any) => publisher.runtime(event) };
}
