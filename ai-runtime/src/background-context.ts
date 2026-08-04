import type { AiRunResult, RunAiOptions } from "./runtime-types.ts";

export type BackgroundTriggerContext = {
  type: "heartbeat" | "cron";
  id: string;
  scheduledAt: string;
  firedAt: string;
  appId: string;
  packageHash: string;
  runId: string;
  attempt: number;
  previous?: { status: "completed" | "failed"; finishedAt: string; outputSummary?: string };
};

export type ContactRequest = {
  nodeId: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  webhook: boolean;
  dedupeKey?: string;
  trigger: BackgroundTriggerContext;
};

export type ContactReceipt = { id: string; status: "queued"; webhookQueued: boolean; createdAt: string };

export type BackgroundRunServices = {
  trigger: BackgroundTriggerContext;
  history?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  contact(request: ContactRequest): Promise<ContactReceipt>;
};

export const BACKGROUND_RUN = Symbol("agcomm.runtime.background-run");

export type BackgroundRunnableApp = {
  [BACKGROUND_RUN](options: RunAiOptions, services: BackgroundRunServices): Promise<AiRunResult>;
};
