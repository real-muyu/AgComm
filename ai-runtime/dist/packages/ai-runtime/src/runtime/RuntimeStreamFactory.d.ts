import type { ProjectExecutionContext, RuntimeProject } from "./ProjectExecutor.ts";
import type { AiRunResult, AiRunStream, AiStreamEvent, StreamRunOptions } from "../runtime-types.ts";
export declare function createRuntimeStreamFactory(execute: (project: RuntimeProject, options: StreamRunOptions, context: ProjectExecutionContext) => Promise<AiRunResult>): (project: RuntimeProject, streamOptions: StreamRunOptions | undefined, context: ProjectExecutionContext) => AiRunStream<string | AiStreamEvent>;
