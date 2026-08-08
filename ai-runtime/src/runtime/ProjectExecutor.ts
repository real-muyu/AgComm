import type { BackgroundRunServices } from "../background-context.ts";
import type { ConversationMessage } from "../storage-contracts.ts";
import type { RuntimeOptions } from "../runtime-types.ts";
import type { ModelProvider, ProviderConfig } from "./contracts/ModelPort.ts";
import type { PluginManager } from "./PluginManager.ts";
import { createProjectExecutionRunner } from "./ProjectExecutionRunner.ts";

export { parseRuntimeProject } from "./PackageParser.ts";
export type { RuntimeProject } from "./PackageParser.ts";

export type ProjectExecutionContext = { packageHash: string; sessionId?: string; history?: readonly ConversationMessage[]; knowledgeContext?: string; background?: BackgroundRunServices };
export type ProjectExecutorDependencies = { options: RuntimeOptions; config: ProviderConfig; provider: ModelProvider; controllers: Set<AbortController>; managers: Set<PluginManager> };

export function createProjectExecutor(dependencies: ProjectExecutorDependencies) {
  return createProjectExecutionRunner(dependencies);
}
