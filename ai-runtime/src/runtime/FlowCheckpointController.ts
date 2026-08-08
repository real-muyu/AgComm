import { compileFlow, compileInputValues } from "../../../../domain/flow/compiler.ts";
import { readInputForm } from "../../../../domain/flow/input-form.ts";
import type { FlowProject } from "../../../../domain/flow/types.ts";
import { FlowRuntime, type FlowEvent } from "../../../../lib/flow-runtime/index.ts";
import type { FlowCheckpoint, FlowRunResult, ExecutorRegistry, RuntimeServices } from "../../../../lib/flow-runtime/types.ts";
import { AiRuntimeError } from "../errors.ts";
import type { RuntimeInputField } from "../renderer.ts";
import type { FlowExecutionInput } from "./FlowExecutionService.ts";

export class FlowCheckpointController {
  constructor(private readonly input: FlowExecutionInput, private readonly flow: ReturnType<typeof compileFlow>, private readonly services: RuntimeServices, private readonly executors: ExecutorRegistry) {}
  async run() {
    const { controller, renderer, variables, flowHooks, outputStream, emit } = this.input; const inputNodeIds = renderer ? this.flow.nodes.filter((node) => node.type === "INPUT").map((node) => node.id) : []; const runtime = new FlowRuntime(); let checkpoint: FlowCheckpoint | undefined; let result: FlowRunResult;
    for (;;) { result = await runtime.run(this.flow, { ...(checkpoint ? { resumeFrom: checkpoint } : { variables }), signal: controller.signal, breakpointNodeIds: inputNodeIds, onEvent: (event: FlowEvent) => { if (event.type === "node:complete") outputStream?.completeOutput(event.nodeId, event.output); emit({ type: "flow", event }); }, services: this.services, executors: this.executors, hooks: { beforeNode: (event) => flowHooks.beforeNode(event), afterNode: (event) => flowHooks.afterNode(event), onNodeError: (event) => flowHooks.onNodeError(event) } }); if (!renderer || result.status !== "paused" || !result.checkpoint) return result; checkpoint = await this.resumeInput(result.checkpoint); }
  }
  private async resumeInput(checkpoint: FlowCheckpoint) { const { project, controller, renderer } = this.input; const node = project.nodes.find((item) => item.id === checkpoint.pausedBeforeNodeId && item.type === "INPUT"); if (!node) throw new AiRuntimeError("INPUT_NODE_INVALID", `Paused INPUT node was not found: ${checkpoint.pausedBeforeNodeId}`); const form = readInputForm(node as FlowProject["nodes"][number], project.variables); if (!form.fields.length) return checkpoint; let draft = { ...checkpoint.variables }; let validationError: string | undefined; for (;;) { const submitted = await renderer.requestInput({ projectName: project.name, node: { id: node.id, title: node.title }, form: { layout: form.layout, fields: form.fields.map((field): RuntimeInputField => ({ ...field, variableType: project.variables.find((v) => v.name === field.variable)?.type ?? "string" })) }, variables: draft, validationError, signal: controller.signal }); try { const parsed = compileInputValues(project as unknown as FlowProject, node.id, submitted); return { ...checkpoint, variables: { ...checkpoint.variables, ...parsed } }; } catch (error) { draft = { ...draft, ...submitted }; validationError = error instanceof Error ? error.message : String(error); } } }
}
