// SPDX-License-Identifier: Elastic-2.0
import { createHmac, randomUUID } from "node:crypto";
import { AiRuntimeError, createSafeOutboundFetch, type ContactReceipt, type ContactRequest } from "@agcomm/ai-runtime/gateway-host";
import { atomicWrite, gatewayAppId, readJson, type GatewayAppSummary, type GatewayCredentialStore, type GatewayDelivery, type GatewayInboxItem, type GatewayState, type NotificationAdapter } from "./GatewayState.ts";
import { deliverPendingNotifications } from "./GatewayDeliveryService.ts";

const MAX_INBOX = 10_000;
const INBOX_RETENTION_MS = 90 * 24 * 60 * 60_000;

export function createGatewayCredentialStore(): GatewayCredentialStore {
  const entry = async (id: string) => { try { const { AsyncEntry } = await import("@napi-rs/keyring"); return new AsyncEntry("io.agcomm.runtime.gateway.webhook", gatewayAppId(id)); } catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Gateway webhook credential storage is unavailable", { cause: error }); } };
  return { async get(id) { try { return await (await entry(id)).getPassword(); } catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to read Gateway webhook secret", { cause: error }); } }, async set(id, secret) { try { await (await entry(id)).setPassword(secret); } catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to save Gateway webhook secret", { cause: error }); } }, async delete(id) { try { await (await entry(id)).deleteCredential(); } catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to delete Gateway webhook secret", { cause: error }); } } };
}

/** Owns credential selection and notification adapter registration. */
export class GatewayNotifier {
  readonly adapters = new Map<string, NotificationAdapter>();
  constructor(readonly credentials: GatewayCredentialStore, adapters: readonly NotificationAdapter[], private readonly state?: GatewayState, private readonly now: () => Date = () => new Date(), private readonly fetcher?: typeof globalThis.fetch) {
    for (const adapter of adapters) { if (!adapter.id || this.adapters.has(adapter.id) || adapter.id === "webhook") throw new AiRuntimeError("NOTIFICATION_ADAPTER_INVALID", `Invalid or duplicate notification adapter: ${adapter.id}`); this.adapters.set(adapter.id, adapter); }
  }
  private requireState() { if (!this.state) throw new AiRuntimeError("GATEWAY_NOT_INITIALIZED", "Gateway notification state is unavailable"); return this.state; }
  async listInbox(id: string) { const state = this.requireState(); state.app(id); return readJson<GatewayInboxItem[]>(state.statePath(id, "inbox.json"), []); }
  async markRead(id: string, notificationIds: readonly string[]) { const state = this.requireState(); state.app(id); await state.withLock(`${id}:notifications`, async () => { const set = new Set(notificationIds); const inbox = await readJson<GatewayInboxItem[]>(state.statePath(id, "inbox.json"), []); const at = this.now().toISOString(); for (const item of inbox) if (set.has(item.id)) item.readAt = at; await atomicWrite(state.statePath(id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}\n`); }); }
  async retry(id: string, notificationId: string) { const state = this.requireState(); state.app(id); await state.withLock(`${id}:notifications`, async () => { const deliveries = await readJson<GatewayDelivery[]>(state.statePath(id, "deliveries.json"), []); const delivery = deliveries.find((item) => item.notificationId === notificationId && item.status === "failed"); if (!delivery) throw new AiRuntimeError("GATEWAY_DELIVERY_NOT_FOUND", `Failed delivery was not found: ${notificationId}`); Object.assign(delivery, { status: "queued", attempts: 0, nextAttemptAt: this.now().toISOString() }); delete delivery.lastError; await atomicWrite(state.statePath(id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}\n`); }); }
  async recordContact(app: GatewayAppSummary, request: ContactRequest): Promise<ContactReceipt> {
    const state = this.requireState(); return state.withLock(`${app.id}:notifications`, async () => {
      const now = this.now(); let inbox = (await readJson<GatewayInboxItem[]>(state.statePath(app.id, "inbox.json"), [])).filter((item) => now.getTime() - new Date(item.updatedAt).getTime() <= INBOX_RETENTION_MS);
      const duplicate = request.dedupeKey ? inbox.find((item) => item.dedupeKey === request.dedupeKey && now.getTime() - new Date(item.updatedAt).getTime() < 86_400_000) : undefined;
      if (duplicate) return { id: duplicate.id, status: "queued", webhookQueued: duplicate.deliveryStatus === "queued", createdAt: duplicate.createdAt };
      const adapterIds = [...app.notificationAdapters, ...(request.webhook ? ["webhook"] : [])];
      const item: GatewayInboxItem = { id: randomUUID(), appId: app.id, packageHash: app.packageHash, nodeId: request.nodeId, triggerId: request.trigger.id, runId: request.trigger.runId, title: request.title, body: request.body, severity: request.severity, ...(request.dedupeKey ? { dedupeKey: request.dedupeKey } : {}), createdAt: now.toISOString(), updatedAt: now.toISOString(), deliveryStatus: adapterIds.length ? "queued" : "none" };
      inbox.push(item); if (inbox.length > MAX_INBOX) inbox = inbox.slice(-MAX_INBOX); await atomicWrite(state.statePath(app.id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}\n`);
      if (adapterIds.length) { const deliveries = await readJson<GatewayDelivery[]>(state.statePath(app.id, "deliveries.json"), []); for (const adapterId of new Set(adapterIds)) deliveries.push({ id: randomUUID(), notificationId: item.id, adapterId, attempts: 0, nextAttemptAt: now.toISOString(), status: "queued" }); await atomicWrite(state.statePath(app.id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}\n`); }
      return { id: item.id, status: "queued", webhookQueued: request.webhook, createdAt: item.createdAt };
    });
  }
  async deliverWebhook(app: GatewayAppSummary, item: GatewayInboxItem, signal: AbortSignal) {
    if (!app.webhookUrl) throw new AiRuntimeError("GATEWAY_WEBHOOK_REQUIRED", `Webhook URL is missing for ${app.id}`); const secret = await this.credentials.get(app.id); if (!secret) throw new AiRuntimeError("GATEWAY_WEBHOOK_REQUIRED", `Webhook secret is missing for ${app.id}`);
    const payload = JSON.stringify({ id: item.id, appId: item.appId, packageHash: item.packageHash, triggerId: item.triggerId, runId: item.runId, title: item.title, body: item.body, severity: item.severity, createdAt: item.createdAt }); const timestamp = String(Math.floor(this.now().getTime() / 1_000)); const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    const response = await createSafeOutboundFetch({ maxRedirects: 0, maxResponseBytes: 65_536, signal, fetcher: this.fetcher })(app.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-agcomm-event": item.id, "x-agcomm-timestamp": timestamp, "x-agcomm-signature": `sha256=${signature}` }, body: payload }); if (!response.ok) throw new AiRuntimeError("GATEWAY_WEBHOOK_FAILED", `Webhook returned HTTP ${response.status}`);
  }
  async deliverPending() { const state = this.requireState(); return deliverPendingNotifications({ apps: state.registry.apps, adapters: this.adapters, now: this.now, statePath: (id, name) => state.statePath(id, name), withLock: (key, action) => state.withLock(key, action), deliverWebhook: (app, item, signal) => this.deliverWebhook(app, item, signal) }); }
}
