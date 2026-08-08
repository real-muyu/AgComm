// SPDX-License-Identifier: Elastic-2.0
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";
import { atomicWrite, readJson, type GatewayAppSummary, type GatewayDelivery, type GatewayInboxItem, type NotificationAdapter } from "./GatewayState.ts";

const RETRY_DELAYS = [60_000, 300_000, 1_800_000, 7_200_000] as const;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 4_096);
export type GatewayDeliveryPort = {
  apps: readonly GatewayAppSummary[];
  adapters: ReadonlyMap<string, NotificationAdapter>;
  now(): Date;
  statePath(id: string, name: string): string;
  withLock<T>(key: string, action: () => Promise<T>): Promise<T>;
  deliverWebhook(app: GatewayAppSummary, item: GatewayInboxItem, signal: AbortSignal): Promise<void>;
};

async function deliverOne(port: GatewayDeliveryPort, app: GatewayAppSummary, delivery: GatewayDelivery, notification: GatewayInboxItem, now: Date, deliveries: GatewayDelivery[]) {
  try {
    if (delivery.adapterId === "webhook") await port.deliverWebhook(app, notification, new AbortController().signal);
    else { const adapter = port.adapters.get(delivery.adapterId); if (!adapter) throw new AiRuntimeError("NOTIFICATION_ADAPTER_NOT_FOUND", `Notification adapter is unavailable: ${delivery.adapterId}`); await adapter.deliver(notification, { app: structuredClone(app), signal: new AbortController().signal }); }
    delivery.status = "delivered";
    notification.deliveryStatus = deliveries.some((item) => item.notificationId === notification.id && item !== delivery && item.status !== "delivered") ? "queued" : "delivered";
    delete delivery.lastError;
  } catch (error) {
    delivery.lastError = message(error);
    const delay = RETRY_DELAYS[delivery.attempts++];
    if (delay === undefined) { delivery.status = "failed"; notification.deliveryStatus = "failed"; }
    else delivery.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
  }
  notification.updatedAt = now.toISOString();
}

export async function deliverPendingNotifications(port: GatewayDeliveryPort) {
  const now = port.now();
  for (const app of port.apps) await port.withLock(`${app.id}:notifications`, async () => {
    const deliveries = await readJson<GatewayDelivery[]>(port.statePath(app.id, "deliveries.json"), []);
    const inbox = await readJson<GatewayInboxItem[]>(port.statePath(app.id, "inbox.json"), []);
    let changed = false;
    for (const delivery of deliveries.filter((item) => item.status === "queued" && new Date(item.nextAttemptAt) <= now)) {
      const notification = inbox.find((item) => item.id === delivery.notificationId);
      if (!notification) { delivery.status = "failed"; delivery.lastError = "Inbox item was removed"; changed = true; continue; }
      await deliverOne(port, app, delivery, notification, now, deliveries);
      changed = true;
    }
    if (changed) { await atomicWrite(port.statePath(app.id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}\n`); await atomicWrite(port.statePath(app.id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}\n`); }
  });
}
