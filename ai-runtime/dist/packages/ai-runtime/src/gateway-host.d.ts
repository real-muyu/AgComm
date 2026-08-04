import type { AppBackgroundConfig, CronTriggerConfig, HeartbeatTriggerConfig } from "../../../domain/flow/types.ts";
import { createSafeOutboundFetch, validateResolvedPublicUrl } from "../../../lib/network-security.ts";
import { type BackgroundRunServices, type BackgroundTriggerContext, type ContactReceipt, type ContactRequest } from "./background-context.ts";
import { AiRuntimeError } from "./errors.ts";
import type { AiRunResult, AiStreamEvent, AiStreamMode, RunAiOptions, RuntimeOptions } from "./runtime-types.ts";
export { AiRuntimeError, createSafeOutboundFetch, validateResolvedPublicUrl };
export type { AiRunResult, AiStreamEvent, AiStreamMode, AppBackgroundConfig, BackgroundTriggerContext, ContactReceipt, ContactRequest, CronTriggerConfig, HeartbeatTriggerConfig, RunAiOptions, RuntimeOptions, };
export type GatewayPackageInspection = {
    appId: string;
    name: string;
    version: string;
    packageHash: string;
    background: AppBackgroundConfig;
    requiresWebhook: boolean;
    defaultStreamMode: AiStreamMode;
};
export declare function inspectGatewayPackage(pathOrBytes: string | Uint8Array | ArrayBuffer, runtimeOptions?: RuntimeOptions): Promise<GatewayPackageInspection>;
export declare function executeGatewayTrigger(pathOrBytes: string | Uint8Array | ArrayBuffer, runtimeOptions: RuntimeOptions | undefined, runOptions: RunAiOptions, services: BackgroundRunServices): Promise<AiRunResult>;
