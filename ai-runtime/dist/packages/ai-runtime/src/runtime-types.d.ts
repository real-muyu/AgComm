import type { FlowEvent } from "../../../lib/flow-runtime/index.ts";
import type { FlowProject } from "../../../domain/flow/types.ts";
import type { WorkspaceToolTrace } from "../../../lib/workspace-tool-calling.ts";
import type { ConversationMessage, EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeProgress, KnowledgeScope, SessionSummary } from "./app-storage.ts";
import type { HttpModelProviderConfig } from "./http-provider.ts";
import type { ModelEvent, ModelProvider, ProviderConfig } from "./model-provider.ts";
import type { PermissionAdapter, PluginLog } from "./plugin-sandbox.ts";
import type { RuntimeRenderer } from "./renderer.ts";
export type { ProviderConfig } from "./model-provider.ts";
export type RuntimeBundleKind = "plugin" | "code" | "hook" | "flow-hook";
export type RuntimeTrustRequest = {
    packageHash: string;
    bundleId: string;
    kind: RuntimeBundleKind;
    name: string;
    version: string;
    integrity: string;
    permissions: readonly string[];
    signature?: {
        algorithm: "Ed25519";
        keyId: string;
        value: string;
    };
};
export type RuntimeTrustDecision = {
    trusted: boolean;
    allowUnsigned?: boolean;
    grants?: readonly string[];
};
export interface RuntimeTrustProvider {
    authorize(request: RuntimeTrustRequest): Promise<RuntimeTrustDecision>;
}
export type RuntimeEvent = {
    type: "flow";
    event: FlowEvent;
} | {
    type: "tool";
    trace: WorkspaceToolTrace;
} | {
    type: "hook";
    hookId: string;
    workspaceId: string;
    stage: string;
    status: "start" | "complete" | "error";
    elapsedMs?: number;
} | {
    type: "flow-hook";
    hookId: string;
    nodeId: string;
    stage: string;
    status: "start" | "complete" | "error";
    elapsedMs?: number;
} | {
    type: "plugin-log";
    log: PluginLog;
};
export type AiStreamMode = "text" | "events";
export type ModelInvocationContext = {
    callId: string;
    nodeId: string;
    nodeType: "SKILL" | "WORKSPACE";
    skillId: string;
    purpose: "skill" | "workspace-agent" | "workspace-skill";
    iteration?: number;
    forceFinal: boolean;
};
type EventBase = {
    sequence: number;
    at: string;
};
export type AiStreamEvent = EventBase & {
    type: "run-start";
    packageHash: string;
    projectName: string;
    mode: AiStreamMode;
} | EventBase & {
    type: "model-start";
    context: ModelInvocationContext;
} | EventBase & {
    type: "model-event";
    context: ModelInvocationContext;
    event: ModelEvent;
} | EventBase & {
    type: "model-complete";
    context: ModelInvocationContext;
    hasToolCalls: boolean;
    contentLength: number;
} | EventBase & {
    type: "runtime-event";
    event: RuntimeEvent;
} | EventBase & {
    type: "output-delta";
    text: string;
    nodeId?: string;
} | EventBase & {
    type: "result";
    result: AiRunResult;
} | EventBase & {
    type: "error";
    error: {
        code: string;
        name: string;
        message: string;
    };
};
export type AiStreamEventInput = AiStreamEvent extends infer Event ? Event extends AiStreamEvent ? Omit<Event, "sequence" | "at"> : never : never;
export type RunAiOptions = {
    input?: string;
    variables?: Record<string, unknown>;
    signal?: AbortSignal;
    onModelEvent?: (event: ModelEvent) => void;
    onRuntimeEvent?: (event: RuntimeEvent) => void;
    onStreamEvent?: (event: AiStreamEvent) => void;
    onOutputDelta?: (text: string) => void;
    mode?: AiStreamMode;
    renderer?: RuntimeRenderer | false;
};
export type StreamRunOptions = RunAiOptions;
export type AiRunResult = {
    ok: true;
    status: "completed" | "paused";
    output: unknown;
    variables: Record<string, unknown>;
    records: unknown[];
    toolCalls: WorkspaceToolTrace[];
    logs: PluginLog[];
    model: string;
    elapsedMs: number;
};
export interface AiRunStream<T> extends AsyncIterable<T> {
    readonly result: Promise<AiRunResult>;
    readonly signal: AbortSignal;
    cancel(reason?: unknown): void;
}
export type RuntimeOptions = {
    provider?: ProviderConfig | HttpModelProviderConfig | ModelProvider;
    trustedKeys?: Record<string, string>;
    grants?: Record<string, string[]>;
    permissions?: PermissionAdapter;
    allowUnsignedPlugins?: boolean;
    dataDir?: string;
    embeddingProvider?: EmbeddingProvider;
    knowledgeParsers?: readonly KnowledgeDocumentParser[];
    trustProvider?: RuntimeTrustProvider;
};
export type KnowledgeImportOptions = {
    scope: KnowledgeScope;
    signal?: AbortSignal;
    onProgress?: (progress: KnowledgeProgress) => void;
};
export type SessionRunOptions = Omit<RunAiOptions, "input">;
export interface AiSessionHandle {
    readonly id: string;
    readonly title: string;
    history(): Promise<ConversationMessage[]>;
    runTurn(input: string, options?: SessionRunOptions): Promise<AiRunResult>;
    streamTurn(input: string, options: SessionRunOptions & {
        mode: "text";
    }): AiRunStream<string>;
    streamTurn(input: string, options: SessionRunOptions & {
        mode: "events";
    }): AiRunStream<AiStreamEvent>;
    streamTurn(input: string, options?: SessionRunOptions & {
        mode?: AiStreamMode;
    }): AiRunStream<string | AiStreamEvent>;
    rename(title: string): Promise<void>;
    dispose(): Promise<void>;
}
export interface AiAppHandle {
    readonly id: string;
    readonly name: string;
    readonly packageHash: string;
    readonly info: AiAppInfo;
    readonly interaction: FlowProject["interaction"];
    readonly background: FlowProject["background"];
    preflight(): Promise<void>;
    run(options?: RunAiOptions): Promise<AiRunResult>;
    stream(options: StreamRunOptions & {
        mode: "text";
    }): AiRunStream<string>;
    stream(options: StreamRunOptions & {
        mode: "events";
    }): AiRunStream<AiStreamEvent>;
    stream(options?: StreamRunOptions): AiRunStream<string | AiStreamEvent>;
    listSessions(): Promise<SessionSummary[]>;
    createSession(options?: {
        title?: string;
    }): Promise<AiSessionHandle>;
    openSession(id: string): Promise<AiSessionHandle>;
    deleteSession(id: string): Promise<void>;
    listKnowledge(scope: KnowledgeScope): Promise<KnowledgeDocument[]>;
    importKnowledge(paths: readonly string[], options: KnowledgeImportOptions): Promise<KnowledgeDocument[]>;
    removeKnowledge(ids: readonly string[], scope: KnowledgeScope): Promise<void>;
    reindexKnowledge(ids: readonly string[] | undefined, options: KnowledgeImportOptions): Promise<KnowledgeDocument[]>;
    dispose(): Promise<void>;
}
export type AiAppInfo = {
    formatVersion: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    packageHash: string;
    nodes: ReadonlyArray<{
        id: string;
        title: string;
        type: string;
    }>;
    bundles: ReadonlyArray<{
        id: string;
        name: string;
        version: string;
        kind: RuntimeBundleKind;
        runtime: "player" | "runtime";
        permissions: readonly string[];
        signed: boolean;
    }>;
    background?: {
        appId: string;
        version: string;
        triggerCount: number;
        contactCount: number;
        requiresWebhook: boolean;
        triggers: ReadonlyArray<{
            id: string;
            type: "heartbeat" | "cron";
            schedule: string;
        }>;
    };
};
export interface AiRuntime {
    runAiFile(pathOrBytes: string | Uint8Array | ArrayBuffer, options?: RunAiOptions): Promise<AiRunResult>;
    streamAiFile(pathOrBytes: string | Uint8Array | ArrayBuffer, options: StreamRunOptions & {
        mode: "text";
    }): Promise<AiRunStream<string>>;
    streamAiFile(pathOrBytes: string | Uint8Array | ArrayBuffer, options: StreamRunOptions & {
        mode: "events";
    }): Promise<AiRunStream<AiStreamEvent>>;
    streamAiFile(pathOrBytes: string | Uint8Array | ArrayBuffer, options?: StreamRunOptions): Promise<AiRunStream<string | AiStreamEvent>>;
    openAiApp(pathOrBytes: string | Uint8Array | ArrayBuffer): Promise<AiAppHandle>;
    dispose(): Promise<void>;
}
