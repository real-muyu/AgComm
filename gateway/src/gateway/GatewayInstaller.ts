// SPDX-License-Identifier: Elastic-2.0
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AiRuntimeError, inspectGatewayPackage, validateResolvedPublicUrl, type RuntimeOptions } from "@agcomm/ai-runtime/gateway-host";
import { atomicWrite, gatewayAppId, type GatewayAppSummary, type GatewayInstallOptions, type GatewayRegistry, type NotificationAdapter } from "./GatewayState.ts";

export type GatewayInstallerPort = {
  root: string;
  runtime?: RuntimeOptions;
  registry: GatewayRegistry;
  adapters: ReadonlyMap<string, NotificationAdapter>;
  now(): Date;
  credential(id: string): Promise<string | undefined>;
  saveCredential(id: string, secret: string): Promise<void>;
  stopActive(id: string, reason: string): Promise<void>;
  cancelPending(id: string, reason: string): Promise<void>;
  triggers(background: GatewayAppSummary["background"]): Array<{ id: string; everyMs?: number; runOnStart?: boolean }>;
  nextRun(trigger: any, after: Date): Date;
  saveRegistry(): Promise<void>;
  statePath(id: string, name: string): string;
};

function validateWebhook(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new AiRuntimeError("GATEWAY_WEBHOOK_INVALID", "Webhook URL must be credential-free HTTPS without a query or fragment");
  return validateResolvedPublicUrl(url, { signal: new AbortController().signal }).catch((error) => {
    throw new AiRuntimeError("GATEWAY_WEBHOOK_INVALID", "Webhook URL must resolve to a public HTTPS endpoint", { cause: error });
  });
}

export async function installGatewayApplication(port: GatewayInstallerPort, pathOrBytes: string | Uint8Array | ArrayBuffer, install: GatewayInstallOptions = {}) {
  const bytes = typeof pathOrBytes === "string" ? new Uint8Array(await readFile(pathOrBytes)) : new Uint8Array(pathOrBytes);
  const inspected = await inspectGatewayPackage(bytes, port.runtime);
  const id = gatewayAppId(inspected.appId);
  const existing = port.registry.apps.find((app) => app.id === id);
  const webhookUrl = install.webhook?.url ?? existing?.webhookUrl;
  if (inspected.requiresWebhook && !webhookUrl) throw new AiRuntimeError("GATEWAY_WEBHOOK_REQUIRED", `App ${id} requires a Webhook URL`);
  if (webhookUrl) await validateWebhook(webhookUrl);
  if (install.webhook?.secret !== undefined) {
    if (install.webhook.secret.length < 16 || install.webhook.secret.length > 512) throw new AiRuntimeError("GATEWAY_WEBHOOK_SECRET_INVALID", "Webhook signing secret must contain 16–512 characters");
    await port.saveCredential(id, install.webhook.secret);
  } else if (inspected.requiresWebhook && !(await port.credential(id))) throw new AiRuntimeError("GATEWAY_WEBHOOK_REQUIRED", `App ${id} requires a Webhook signing secret`);
  const configuredAdapters = [...new Set(install.notificationAdapters ?? existing?.notificationAdapters ?? [])];
  for (const adapter of configuredAdapters) if (!port.adapters.has(adapter)) throw new AiRuntimeError("NOTIFICATION_ADAPTER_NOT_FOUND", `Notification adapter is not registered: ${adapter}`);
  const packageHash = createHash("sha256").update(bytes).digest("hex");
  if (packageHash !== inspected.packageHash) throw new AiRuntimeError("GATEWAY_PACKAGE_INVALID", "Runtime package hash does not match the installed bytes");
  if (existing && existing.packageHash !== packageHash) {
    await port.stopActive(id, "Gateway app package was replaced");
    await port.cancelPending(id, "Gateway app package was replaced");
  }
  const appDirectory = join(port.root, "apps", id);
  await mkdir(appDirectory, { recursive: true, mode: 0o700 });
  await atomicWrite(join(appDirectory, "app.ai"), bytes);
  const now = port.now();
  const nextRuns: Record<string, string> = {};
  for (const trigger of port.triggers(inspected.background)) nextRuns[trigger.id] = (trigger.everyMs && trigger.runOnStart ? now : port.nextRun(trigger, now)).toISOString();
  const record: GatewayAppSummary = {
    id, name: inspected.name, version: inspected.version, packageHash, enabled: install.enabled !== false,
    installedAt: existing?.installedAt ?? now.toISOString(), updatedAt: now.toISOString(), background: structuredClone(inspected.background),
    requiresWebhook: inspected.requiresWebhook, ...(webhookUrl ? { webhookUrl } : {}), notificationAdapters: configuredAdapters,
    nextRuns, defaultStreamMode: inspected.defaultStreamMode,
  };
  port.registry.apps = [...port.registry.apps.filter((app) => app.id !== id), record];
  if (existing?.packageHash !== packageHash) await atomicWrite(port.statePath(id, "sessions.json"), "{}\n");
  await port.saveRegistry();
  return structuredClone(record);
}
