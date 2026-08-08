import type { AiRunResult, AiRunStream, AiStreamEvent, RunAiOptions, StreamRunOptions } from "../../runtime-types.ts";
import type { RuntimeProject } from "../PackageParser.ts";
import type { ProjectExecutionContext } from "../ProjectExecutor.ts";
export type RuntimeAppExecutionPort = {
    executeProject(project: RuntimeProject, options: RunAiOptions, context: ProjectExecutionContext): Promise<AiRunResult>;
    streamProject(project: RuntimeProject, options: StreamRunOptions, context: ProjectExecutionContext): AiRunStream<string | AiStreamEvent>;
    preflightProject(project: RuntimeProject, packageHash: string): Promise<void>;
};
