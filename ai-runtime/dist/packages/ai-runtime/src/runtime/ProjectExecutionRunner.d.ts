import type { AiRunResult, RunAiOptions } from "../runtime-types.ts";
import type { ProjectExecutionContext, ProjectExecutorDependencies } from "./ProjectExecutor.ts";
import type { RuntimeProject } from "./PackageParser.ts";
export declare function createProjectExecutionRunner({ options, config, provider, controllers, managers }: ProjectExecutorDependencies): (project: RuntimeProject, runOptions: RunAiOptions | undefined, context: ProjectExecutionContext) => Promise<AiRunResult>;
