import type { AppBackgroundConfig, CronTriggerConfig, HeartbeatTriggerConfig } from "../../../domain/flow/types.ts";
import { createSafeOutboundFetch, validateResolvedPublicUrl } from "../../../lib/network-security.ts";
import { BACKGROUND_RUN, type BackgroundRunServices, type BackgroundRunnableApp, type BackgroundTriggerContext, type ContactReceipt, type ContactRequest } from "./background-context.ts";
import { AiRuntimeError } from "./errors.ts";
import { createRuntime } from "./index.ts";
import type { AiRunResult, AiStreamEvent, AiStreamMode, RunAiOptions, RuntimeOptions } from "./runtime-types.ts";

export { AiRuntimeError, createSafeOutboundFetch, validateResolvedPublicUrl };
export type {
  AiRunResult,
  AiStreamEvent,
  AiStreamMode,
  AppBackgroundConfig,
  BackgroundTriggerContext,
  ContactReceipt,
  ContactRequest,
  CronTriggerConfig,
  HeartbeatTriggerConfig,
  RunAiOptions,
  RuntimeOptions,
};

export type GatewayPackageInspection = {
  appId: string;
  name: string;
  version: string;
  packageHash: string;
  background: AppBackgroundConfig;
  requiresWebhook: boolean;
  defaultStreamMode: AiStreamMode;
};

export async function inspectGatewayPackage(
  pathOrBytes: string | Uint8Array | ArrayBuffer,
  runtimeOptions: RuntimeOptions = {},
): Promise<GatewayPackageInspection> {
  const runtime = createRuntime(runtimeOptions);
  const opened = await runtime.openAiApp(pathOrBytes);
  try {
    await opened.preflight();
    const details = opened.info.background;
    if (!details || !opened.background) {
      throw new AiRuntimeError("GATEWAY_BACKGROUND_REQUIRED", "Only apps with stable id, version, and background declarations can be installed");
    }
    return {
      appId: details.appId,
      name: opened.name,
      version: details.version,
      packageHash: opened.packageHash,
      background: structuredClone(opened.background),
      requiresWebhook: details.requiresWebhook,
      defaultStreamMode: opened.interaction?.streaming?.defaultMode ?? "text",
    };
  } finally {
    await opened.dispose();
    await runtime.dispose();
  }
}

export async function executeGatewayTrigger(
  pathOrBytes: string | Uint8Array | ArrayBuffer,
  runtimeOptions: RuntimeOptions | undefined,
  runOptions: RunAiOptions,
  services: BackgroundRunServices,
): Promise<AiRunResult> {
  const runtime = createRuntime(runtimeOptions);
  const opened = await runtime.openAiApp(pathOrBytes);
  try {
    return await (opened as unknown as BackgroundRunnableApp)[BACKGROUND_RUN](runOptions, services);
  } finally {
    await opened.dispose();
    await runtime.dispose();
  }
}
