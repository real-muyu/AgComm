import type { SessionRecord } from "../../app-storage.ts";
import type { AiRunResult, AiSessionHandle, SessionRunOptions } from "../../runtime-types.ts";
import type { RuntimeProject } from "../ProjectExecutor.ts";
import type { SessionKnowledgeResolver } from "./SessionKnowledgeResolver.ts";
import type { SessionRepository } from "./SessionRepository.ts";
export type SessionExecution = (options: SessionRunOptions & {
    input: string;
}, context: {
    packageHash: string;
    sessionId: string;
    history: SessionRecord["messages"];
    knowledgeContext: string;
}) => Promise<AiRunResult>;
export declare function createRuntimeSessionHandle(options: {
    initial: SessionRecord;
    repository: SessionRepository;
    knowledge: SessionKnowledgeResolver;
    project: RuntimeProject;
    packageHash: string;
    execute: SessionExecution;
}): AiSessionHandle;
