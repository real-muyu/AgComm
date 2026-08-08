import { compileFlow } from "../../../../domain/flow/compiler.ts";
import type { FlowProject } from "../../../../domain/flow/types.ts";
import type { RuntimeServices } from "../../../../lib/flow-runtime/types.ts";
import type { BackgroundRunServices } from "../background-context.ts";
import type { FlowHookPipeline } from "./FlowHookPipeline.ts";
import type { PluginManager } from "./PluginManager.ts";
import type { RuntimeProject } from "./PackageParser.ts";
import { createNodeExecutorRegistry } from "./NodeExecutorRegistry.ts";
import { FlowCheckpointController } from "./FlowCheckpointController.ts";

export type FlowExecutionInput = { project: RuntimeProject; context: { background?: BackgroundRunServices }; controller: AbortController; renderer?: any; variables: Record<string, unknown>; manager: PluginManager; flowHooks: FlowHookPipeline; runSkill: NonNullable<RuntimeServices["runSkill"]>; runWorkspace: NonNullable<RuntimeServices["runWorkspace"]>; outputStream?: { completeOutput(nodeId: string, value: unknown): void }; emit(event: any): void };

export async function executeFlow(input: FlowExecutionInput) {
  const flow = compileFlow(input.project as unknown as FlowProject);
  if ("formatVersion" in input.project && input.project.formatVersion >= 3) for (const node of flow.nodes) if ((node.type as string) === "CODE") node.retry = { maxAttempts: 1, delayMs: 0, backoff: "fixed" };
  const registry = createNodeExecutorRegistry(input);
  return new FlowCheckpointController(input, flow, registry.services, registry.executors).run();
}
