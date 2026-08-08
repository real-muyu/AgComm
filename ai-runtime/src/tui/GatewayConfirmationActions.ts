import type { AiAppInfo } from "../runtime-types.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { GatewayClientLike } from "../gateway-loader.ts";

export async function disableBackgroundApp(client: GatewayClientLike, appId: string) {
  if ((await client.listApps()).some((app) => app.id === appId)) await client.disable(appId);
}

async function collectWebhook(screen: TerminalScreen, existing: Awaited<ReturnType<GatewayClientLike["listApps"]>>[number] | undefined, signal?: AbortSignal) {
  const url = await screen.prompt("Gateway Webhook", `公开 HTTPS URL${existing?.webhookUrl ? `（留空保留 ${existing.webhookUrl}）` : ""}`, signal);
  if (url === undefined) return undefined;
  const secret = await screen.prompt("Gateway Webhook", existing ? "签名密钥（留空保留）" : "签名密钥（至少 16 字符）", signal, { secret: true });
  if (secret === undefined) return undefined;
  return { url: url || existing?.webhookUrl || "", ...(secret ? { secret } : {}) };
}

export async function installBackgroundApp(screen: TerminalScreen, client: GatewayClientLike, info: AiAppInfo, path: string, signal?: AbortSignal) {
  const existing = (await client.listApps()).find((app) => app.id === info.background!.appId);
  const webhook = info.background!.requiresWebhook ? await collectWebhook(screen, existing, signal) : null;
  if (info.background!.requiresWebhook && !webhook) return false;
  await client.install(path, { enabled: true, ...(webhook ? { webhook } : {}) });
  return true;
}
