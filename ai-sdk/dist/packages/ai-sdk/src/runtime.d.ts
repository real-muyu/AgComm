import type { AiRunResult, AiRunStream, AiStreamEvent, AiSessionHandle, KnowledgeDocument, KnowledgeImportOptions, KnowledgeScope, RunAiOptions, RuntimeOptions, SessionSummary, StreamRunOptions } from "@agcomm/ai-runtime";
import type { GatewayInstallOptions, RuntimeGatewayClient } from "@agcomm/gateway";
import type { AppDefinition } from "./model.ts";
export type RunAppOptions = {
    runtime?: RuntimeOptions;
    run?: RunAiOptions;
};
export type StreamAppOptions = {
    runtime?: RuntimeOptions;
    run?: StreamRunOptions;
};
export type AppRunner = {
    readonly packageHash: string;
    readonly info: import("@agcomm/ai-runtime").AiAppInfo;
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
};
export declare function createAppRunner(app: AppDefinition, runtimeOptions?: RuntimeOptions): Promise<AppRunner>;
export declare function runApp(app: AppDefinition, options?: RunAppOptions): Promise<AiRunResult>;
export declare function streamApp(app: AppDefinition, options: StreamAppOptions & {
    run: StreamRunOptions & {
        mode: "text";
    };
}): Promise<AiRunStream<string>>;
export declare function streamApp(app: AppDefinition, options: StreamAppOptions & {
    run: StreamRunOptions & {
        mode: "events";
    };
}): Promise<AiRunStream<AiStreamEvent>>;
export declare function streamApp(app: AppDefinition, options?: StreamAppOptions): Promise<AiRunStream<string | AiStreamEvent>>;
export type InstallBackgroundAppOptions = {
    gateway?: RuntimeGatewayClient;
    gatewayRoot?: string;
    install?: GatewayInstallOptions;
};
export declare function installBackgroundApp(app: AppDefinition, options?: InstallBackgroundAppOptions): Promise<import("@agcomm/gateway").GatewayAppSummary>;
export type { AiAppHandle, AiAppInfo, AiRuntime, AiRunResult, AiRunStream, AiStreamEvent, AiStreamMode, AiSessionHandle, ConversationMessage, EmbeddingProvider, KnowledgeDocument, KnowledgeDocumentParser, KnowledgeImportOptions, KnowledgeMatch, KnowledgeProgress, KnowledgeScope, RunAiOptions, StreamRunOptions, RuntimeOptions, RuntimeEvent, RuntimeTrustDecision, RuntimeTrustProvider, RuntimeTrustRequest, SessionRecord, SessionSummary, } from "@agcomm/ai-runtime";
export type { GatewayAppSummary, GatewayInstallOptions, GatewayRunRecord, GatewayRunStream, GatewayRunTicket, GatewayStartRunOptions, GatewayStreamFrame, RuntimeGatewayClient, } from "@agcomm/gateway";
