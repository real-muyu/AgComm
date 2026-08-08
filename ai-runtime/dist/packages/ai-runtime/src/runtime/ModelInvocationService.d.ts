import type { WorkspaceToolDefinition } from "../../../../lib/workspace-tool-calling.ts";
import type { RuntimeRenderer } from "../renderer.ts";
import type { ModelProvider } from "./contracts/ModelPort.ts";
import type { ModelInvocationContext, RunAiOptions } from "../runtime-types.ts";
import type { OutputStreamCoordinator, StreamPublisher } from "./StreamPublisher.ts";
export declare function createModelInvocationService(input: {
    provider: ModelProvider;
    runOptions: RunAiOptions;
    renderer?: RuntimeRenderer;
    outputStream?: OutputStreamCoordinator;
    publisher: StreamPublisher;
}): (messages: unknown[], tools: WorkspaceToolDefinition[], forceFinal: boolean, signal: AbortSignal, invocation: Omit<ModelInvocationContext, "callId" | "forceFinal">) => Promise<import("./contracts/ModelPort.ts").ModelReply>;
