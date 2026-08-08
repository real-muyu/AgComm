import type { EmbeddingProvider, LocalAppStore } from "../app-storage.ts";
import type { RuntimeProject } from "./ProjectExecutor.ts";
import { type SessionExecution } from "./session/RuntimeSessionHandle.ts";
export type RuntimeSessionFactoryOptions = {
    project: RuntimeProject;
    store: LocalAppStore;
    persistent: boolean;
    embeddingProvider?: EmbeddingProvider;
    execute: SessionExecution;
};
export declare function createRuntimeSessionFactory(options: RuntimeSessionFactoryOptions): {
    assertAppOpen: () => void;
    read: (id: string) => Promise<import("../storage-contracts.ts").SessionRecord>;
    create: (title?: string) => Promise<import("./RuntimeKernel.ts").AiSessionHandle>;
    open: (id: string) => Promise<import("./RuntimeKernel.ts").AiSessionHandle>;
    list: () => Promise<import("../storage-contracts.ts").SessionSummary[]>;
    delete: (id: string) => Promise<void>;
    disposeApp: () => void;
};
