import { readdir } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import type { AiAppInfo, RuntimeTrustDecision, RuntimeTrustRequest } from "./runtime-types.ts";
import type { RuntimePathRequest } from "./host-permissions.ts";
import { LocalRuntimeConfigStore, type ProviderProfile } from "./local-config.ts";
import { TerminalScreen } from "./terminal-app.ts";
import type { TerminalInput, TerminalOutput } from "./terminal-renderer.ts";
import { connectRuntimeGateway, installGatewayAutostart, type GatewayClientLike } from "./gateway-loader.ts";

type TerminalIo = { input?: TerminalInput; output?: TerminalOutput; signal?: AbortSignal };
export type GatewayTerminalIo = TerminalIo & { gateway?: GatewayClientLike; installService?: () => Promise<unknown>; preflight?: () => Promise<void> };

function interrupted(key: { ctrl?: boolean; name?: string }) {
  return key.ctrl && key.name === "c";
}

async function selectPath(
  screen: TerminalScreen,
  options: { title: string; extensions?: readonly string[]; mode?: "read" | "write"; initialDirectory?: string },
  signal?: AbortSignal,
) {
  let directory = resolve(options.initialDirectory ?? process.cwd());
  let selected = 0;
  let message = "";
  const extensions = new Set((options.extensions ?? []).map((item) => item.toLowerCase()));
  for (;;) {
    let entries;
    try {
      entries = (await readdir(directory, { withFileTypes: true }))
        .filter((item) => item.isDirectory() || (item.isFile() && (!extensions.size || extensions.has(extname(item.name).toLowerCase()))))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    } catch (error) {
      message = error instanceof Error ? error.message : "无法读取目录";
      directory = dirname(directory);
      continue;
    }
    const items = [{ name: "..", isDirectory: () => true }, ...entries];
    selected = Math.min(selected, items.length - 1);
    const lines = items.map((item, index) => `${index === selected ? "›" : " "} ${item.isDirectory() ? "▸" : " "} ${item.name}`);
    if (message) lines.push("", message);
    screen.paint(`${options.title} · ${directory}`, lines, `↑↓ 选择  ·  Enter ${options.mode === "write" ? "选择/进入" : "打开/进入"}${options.mode === "write" ? "  ·  N 新文件" : ""}  ·  Q 返回`);
    const { text, key } = await screen.key(signal);
    if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
    if (key.name === "escape" || text?.toLowerCase() === "q") return undefined;
    if (key.name === "up") selected = (selected + items.length - 1) % items.length;
    else if (key.name === "down") selected = (selected + 1) % items.length;
    else if (key.name === "backspace") { directory = dirname(directory); selected = 0; }
    else if (key.name === "return") {
      const item = items[selected];
      const path = resolve(directory, item.name);
      if (item.isDirectory()) { directory = path; selected = 0; }
      else return path;
    } else if (options.mode === "write" && text?.toLowerCase() === "n") {
      const name = await screen.prompt(options.title, "文件名", signal);
      if (name && basename(name) === name && name !== "." && name !== "..") return resolve(directory, name);
      message = "文件名无效";
    }
  }
}

async function editProvider(screen: TerminalScreen, store: LocalRuntimeConfigStore, existing?: ProviderProfile, signal?: AbortSignal) {
  const id = existing?.id ?? await screen.prompt("Provider", "唯一 ID（字母、数字、下划线或连字符）", signal);
  if (!id) return;
  const label = await screen.prompt("Provider", `名称${existing ? `（当前：${existing.label}）` : ""}`, signal);
  if (label === undefined) return;
  const baseUrl = await screen.prompt("Provider", `Base URL${existing ? `（当前：${existing.baseUrl}）` : "，默认 https://api.openai.com/v1"}`, signal);
  if (baseUrl === undefined) return;
  const model = await screen.prompt("Provider", `模型${existing ? `（当前：${existing.model}）` : "，默认 gpt-4.1-mini"}`, signal);
  if (model === undefined) return;
  const embeddingModel = await screen.prompt("Provider", `Embedding 模型${existing?.embeddingModel ? `（当前：${existing.embeddingModel}）` : "（可留空）"}`, signal);
  if (embeddingModel === undefined) return;
  const secret = await screen.prompt("Provider", existing ? "API Key（留空表示不修改）" : "API Key", signal, { secret: true });
  if (secret === undefined || (!existing && !secret)) return;
  await store.saveProfile({
    id,
    label: label || existing?.label || id,
    baseUrl: baseUrl || existing?.baseUrl || "https://api.openai.com/v1",
    model: model || existing?.model || "gpt-4.1-mini",
    ...(embeddingModel || existing?.embeddingModel ? { embeddingModel: embeddingModel || existing?.embeddingModel } : {}),
  }, secret || undefined);
}

async function manageProviders(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal) {
  let selected = 0;
  let message = "";
  for (;;) {
    const config = await store.load();
    const profiles = config.providers;
    selected = Math.min(selected, Math.max(0, profiles.length - 1));
    const lines = profiles.length ? profiles.map((item, index) => `${index === selected ? "›" : " "} ${item.id === config.selectedProviderId ? "●" : "○"} ${item.label} · ${item.model}`) : ["  暂无 Provider"];
    if (message) lines.push("", message);
    screen.paint("Runtime 设置 · Provider", lines, "N 新建  ·  E 编辑  ·  Enter 设为默认  ·  D 删除  ·  Q 返回");
    const { text, key } = await screen.key(signal);
    if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
    if (key.name === "escape" || text?.toLowerCase() === "q") return;
    if (key.name === "up" && profiles.length) selected = (selected + profiles.length - 1) % profiles.length;
    else if (key.name === "down" && profiles.length) selected = (selected + 1) % profiles.length;
    else if (text?.toLowerCase() === "n") { try { await editProvider(screen, store, undefined, signal); message = "Provider 已保存"; } catch (error) { message = error instanceof Error ? error.message : String(error); } }
    else if (text?.toLowerCase() === "e" && profiles[selected]) { try { await editProvider(screen, store, profiles[selected], signal); message = "Provider 已更新"; } catch (error) { message = error instanceof Error ? error.message : String(error); } }
    else if (key.name === "return" && profiles[selected]) { await store.selectProfile(profiles[selected].id); message = "已设为默认 Provider"; }
    else if (text?.toLowerCase() === "d" && profiles[selected]) { try { await store.deleteProfile(profiles[selected].id); selected = Math.max(0, selected - 1); message = "Provider 已删除"; } catch (error) { message = error instanceof Error ? error.message : String(error); } }
  }
}

async function manageKeys(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal) {
  let selected = 0;
  let message = "";
  for (;;) {
    const keys = Object.entries(await store.trustedKeys()).sort(([a], [b]) => a.localeCompare(b));
    selected = Math.min(selected, Math.max(0, keys.length - 1));
    const lines = keys.length ? keys.map(([id], index) => `${index === selected ? "›" : " "} ${id}`) : ["  暂无可信发布者"];
    if (message) lines.push("", message);
    screen.paint("Runtime 设置 · 可信发布者", lines, "N 添加  ·  D 删除  ·  Q 返回");
    const { text, key } = await screen.key(signal);
    if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
    if (key.name === "escape" || text?.toLowerCase() === "q") return;
    if (key.name === "up" && keys.length) selected = (selected + keys.length - 1) % keys.length;
    else if (key.name === "down" && keys.length) selected = (selected + 1) % keys.length;
    else if (text?.toLowerCase() === "n") {
      const id = await screen.prompt("可信发布者", "keyId", signal);
      const value = id ? await screen.prompt("可信发布者", "base64 Ed25519 public key", signal) : undefined;
      if (id && value) { try { await store.saveTrustedKey(id, value); message = "公钥已保存"; } catch (error) { message = error instanceof Error ? error.message : String(error); } }
    } else if (text?.toLowerCase() === "d" && keys[selected]) { await store.removeTrustedKey(keys[selected][0]); selected = Math.max(0, selected - 1); message = "公钥已删除"; }
  }
}

async function manageTrust(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal) {
  let selected = 0;
  for (;;) {
    const records = (await store.listTrustRecords()).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
    selected = Math.min(selected, Math.max(0, records.length - 1));
    const lines = records.length ? records.map((item, index) => `${index === selected ? "›" : " "} ${item.bundleId} · ${item.kind} · ${item.permissions.join(", ") || "无权限"}`) : ["  暂无授权记录"];
    screen.paint("Runtime 设置 · Bundle 授权", lines, "D 撤销  ·  Q 返回");
    const { text, key } = await screen.key(signal);
    if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
    if (key.name === "escape" || text?.toLowerCase() === "q") return;
    if (key.name === "up" && records.length) selected = (selected + records.length - 1) % records.length;
    else if (key.name === "down" && records.length) selected = (selected + 1) % records.length;
    else if (text?.toLowerCase() === "d" && records[selected]) { await store.revokeTrustRecord(records[selected].key); selected = Math.max(0, selected - 1); }
  }
}

async function settings(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal) {
  let selected = 0;
  const items = ["Provider Profiles", "可信发布者", "Bundle 授权"];
  for (;;) {
    screen.paint("AgComm Runtime · 设置", items.map((item, index) => `${index === selected ? "›" : " "} ${item}`), "↑↓ 选择  ·  Enter 打开  ·  Q 返回");
    const { text, key } = await screen.key(signal);
    if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
    if (key.name === "escape" || text?.toLowerCase() === "q") return;
    if (key.name === "up") selected = (selected + items.length - 1) % items.length;
    else if (key.name === "down") selected = (selected + 1) % items.length;
    else if (key.name === "return") {
      if (selected === 0) await manageProviders(screen, store, signal);
      else if (selected === 1) await manageKeys(screen, store, signal);
      else await manageTrust(screen, store, signal);
    }
  }
}

async function gatewayClient(io: GatewayTerminalIo) {
  if (io.gateway) return io.gateway;
  try { const client = await connectRuntimeGateway(); const status = await client.ping(); if (!status.healthy) throw new Error("Gateway heartbeat is stale"); return client; }
  catch {
    await (io.installService ?? (() => installGatewayAutostart()))();
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      try { const client = await connectRuntimeGateway(); const status = await client.ping(); if (status.healthy) return client; } catch { /* Wait for login service. */ }
    }
    throw new Error("Runtime Gateway 启动超时");
  }
}

async function connectedGatewayClient(io: GatewayTerminalIo) {
  if (io.gateway) return io.gateway;
  const client = await connectRuntimeGateway();
  const status = await client.ping();
  if (!status.healthy) throw new Error("Runtime Gateway heartbeat is stale");
  return client;
}

export async function confirmTerminalGateway(info: AiAppInfo, path: string, io: GatewayTerminalIo = {}) {
  if (!info.background) return true;
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr);
  screen.enter();
  try {
    const lines = [
      `应用：${info.background.appId} · ${info.background.version}`,
      `包哈希：${info.packageHash}`,
      `后台触发器：${info.background.triggerCount}`,
      ...info.background.triggers.map((trigger) => `${trigger.type === "cron" ? "Cron" : "Heartbeat"} ${trigger.id}：${trigger.schedule}`),
      `CONTACT 节点：${info.background.contactCount}`,
      `Webhook：${info.background.requiresWebhook ? "需要配置并发送通知内容" : "不需要"}`,
      ...(info.background.requiresWebhook ? ["Webhook 数据：通知 ID、应用/包/触发器/运行 ID、标题、正文、级别和时间"] : []),
      ...info.bundles.flatMap((bundle) => [`${bundle.kind.toUpperCase()}：${bundle.id} · ${bundle.signed ? "已签名" : "未签名"}`, `权限：${bundle.permissions.join("、") || "无"}`]),
      "",
      "接受后将安装当前用户级登录自启 Gateway 并启用该应用。",
      "拒绝会停用已安装的同 ID 应用并退出。",
    ];
    for (;;) {
      screen.paint("启用 Runtime Gateway", lines, "Y 接受并进入  ·  N 停用并退出");
      const { text, key } = await screen.key(io.signal);
      if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
      if (key.name === "escape" || text?.toLowerCase() === "n") {
        try { const client = await connectedGatewayClient(io); const apps = await client.listApps(); if (apps.some((app) => app.id === info.background!.appId)) await client.disable(info.background!.appId); } catch { /* A missing Gateway already means disabled. */ }
        return false;
      }
      if (text?.toLowerCase() !== "y") continue;
      await io.preflight?.();
      const client = await gatewayClient(io);
      const existing = (await client.listApps()).find((app) => app.id === info.background!.appId);
      let webhook: { url: string; secret?: string } | undefined;
      if (info.background.requiresWebhook) {
        const url = await screen.prompt("Gateway Webhook", `公开 HTTPS URL${existing?.webhookUrl ? `（留空保留 ${existing.webhookUrl}）` : ""}`, io.signal);
        if (url === undefined) continue;
        const secret = await screen.prompt("Gateway Webhook", existing ? "签名密钥（留空保留）" : "签名密钥（至少 16 字符）", io.signal, { secret: true });
        if (secret === undefined) continue;
        webhook = { url: url || existing?.webhookUrl || "", ...(secret ? { secret } : {}) };
      }
      await client.install(path, { enabled: true, ...(webhook ? { webhook } : {}) });
      return true;
    }
  } finally { screen.leave(); }
}

async function gatewayManager(screen: TerminalScreen, io: GatewayTerminalIo) {
  const client = await gatewayClient(io);
  let selected = 0;
  let message = "";
  for (;;) {
    const status = await client.ping();
    const apps = await client.listApps();
    selected = Math.min(selected, Math.max(0, apps.length - 1));
    const lines = apps.length ? apps.map((app, index) => {
      const next = Object.values(app.nextRuns).sort()[0];
      return `${index === selected ? "›" : " "} ${app.enabled ? "●" : "○"} ${app.name} · ${app.id} · ${app.version}${next ? ` · ${next}` : ""}`;
    }) : ["  暂无后台应用"];
    if (message) lines.push("", message);
    screen.paint(`Runtime Gateway · ${status.healthy ? "运行中" : "心跳过期"}${status.heartbeatAt ? ` · ${status.heartbeatAt}` : ""}`, lines, "Enter Inbox  ·  H 历史  ·  E 启停  ·  R 立即运行  ·  U 卸载  ·  Q 返回");
    const { text, key } = await screen.key(io.signal);
    if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
    if (key.name === "escape" || text?.toLowerCase() === "q") return;
    if (key.name === "up" && apps.length) selected = (selected + apps.length - 1) % apps.length;
    else if (key.name === "down" && apps.length) selected = (selected + 1) % apps.length;
    else if (text?.toLowerCase() === "e" && apps[selected]) { if (apps[selected].enabled) await client.disable(apps[selected].id); else await client.enable(apps[selected].id); message = apps[selected].enabled ? "已停用" : "已启用"; }
    else if (text?.toLowerCase() === "r" && apps[selected]) {
      const triggers = Object.keys(apps[selected].nextRuns);
      let triggerIndex = 0;
      if (triggers.length > 1) for (;;) {
        screen.paint(`${apps[selected].name} · 立即运行`, triggers.map((id, index) => `${index === triggerIndex ? "›" : " "} ${id}`), "↑↓ 选择  ·  Enter 运行  ·  Q 返回");
        const choice = await screen.key(io.signal);
        if (choice.key.name === "escape" || choice.text?.toLowerCase() === "q") { triggerIndex = -1; break; }
        if (choice.key.name === "up") triggerIndex = (triggerIndex + triggers.length - 1) % triggers.length;
        else if (choice.key.name === "down") triggerIndex = (triggerIndex + 1) % triggers.length;
        else if (choice.key.name === "return") break;
      }
      if (triggers[triggerIndex]) {
        const triggerId = triggers[triggerIndex];
        const ticket = await client.startRunNow(apps[selected].id, triggerId);
        const stream = await client.watchRun(apps[selected].id, ticket.runId, { mode: "text", signal: io.signal });
        let output = "";
        screen.paint(`${apps[selected].name} · ${triggerId}`, ["等待输出…"], "后台运行中");
        for await (const frame of stream) {
          output = `${output}${String(frame.value)}`.slice(-64_000);
          screen.paint(
            `${apps[selected].name} · ${triggerId}`,
            output ? output.split("\n").slice(-40) : ["等待输出…"],
            `后台运行中 · sequence ${frame.sequence}`,
          );
        }
        const record = await stream.completion;
        message = record.status === "completed"
          ? `运行完成 · ${record.elapsedMs ?? 0}ms`
          : `运行${record.status === "cancelled" ? "已取消" : "失败"} · ${record.error ?? "未知错误"}`;
      }
    }
    else if (text?.toLowerCase() === "u" && apps[selected]) { await client.uninstall(apps[selected].id); selected = Math.max(0, selected - 1); message = "已卸载，Inbox 和运行数据保留"; }
    else if (text?.toLowerCase() === "h" && apps[selected]) {
      const runs = (await client.listRuns(apps[selected].id)).slice(-100).reverse();
      screen.paint(`${apps[selected].name} · 运行历史`, runs.flatMap((run) => [`${run.status === "completed" ? "✓" : "×"} ${run.triggerId} · ${run.startedAt} · ${run.elapsedMs}ms`, run.outputSummary ?? run.error ?? "", ""]), "任意键返回");
      await screen.key(io.signal);
    }
    else if (key.name === "return" && apps[selected]) {
      let inboxSelected = 0;
      for (;;) {
        const inbox = (await client.listInbox(apps[selected].id)).slice(-100).reverse();
        inboxSelected = Math.min(inboxSelected, Math.max(0, inbox.length - 1));
        const current = inbox[inboxSelected];
        const inboxLines = inbox.length ? inbox.map((item, index) => `${index === inboxSelected ? "›" : " "} ${item.readAt ? "○" : "●"} ${item.title} · ${item.severity} · ${item.deliveryStatus}`) : ["  Inbox 为空"];
        if (current) inboxLines.push("", current.body, current.createdAt);
        screen.paint(`${apps[selected].name} · Inbox`, inboxLines, "↑↓ 选择  ·  Enter 标记已读  ·  R 重试失败投递  ·  Q 返回");
        const inboxKey = await screen.key(io.signal);
        if (inboxKey.key.name === "escape" || inboxKey.text?.toLowerCase() === "q") break;
        if (inboxKey.key.name === "up" && inbox.length) inboxSelected = (inboxSelected + inbox.length - 1) % inbox.length;
        else if (inboxKey.key.name === "down" && inbox.length) inboxSelected = (inboxSelected + 1) % inbox.length;
        else if (inboxKey.key.name === "return" && current) await client.markInboxRead(apps[selected].id, [current.id]);
        else if (inboxKey.text?.toLowerCase() === "r" && current?.deliveryStatus === "failed") await client.retryDelivery(apps[selected].id, current.id);
      }
    }
  }
}

export async function runTerminalGatewayManager(io: GatewayTerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr);
  screen.enter();
  try { await gatewayManager(screen, io); } finally { screen.leave(); }
}

export async function runTerminalSettings(store: LocalRuntimeConfigStore, io: TerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr);
  screen.enter();
  try { await settings(screen, store, io.signal); }
  finally { screen.leave(); }
}

export async function runTerminalLauncher(store: LocalRuntimeConfigStore, io: GatewayTerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr);
  screen.enter();
  let selected = 0;
  const items = ["打开 .ai", "Gateway", "设置", "退出"];
  try {
    for (;;) {
      const profile = await store.selectedProfile();
      screen.paint("AgComm Runtime", [...items.map((item, index) => `${index === selected ? "›" : " "} ${item}`), "", `Provider: ${profile?.label ?? "未配置"}`], "↑↓ 选择  ·  Enter 确认");
      const { key } = await screen.key(io.signal);
      if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
      if (key.name === "escape") return undefined;
      if (key.name === "up") selected = (selected + items.length - 1) % items.length;
      else if (key.name === "down") selected = (selected + 1) % items.length;
      else if (key.name === "return") {
        if (selected === 0) {
          const path = await selectPath(screen, { title: "打开 .ai", extensions: [".ai"] }, io.signal);
          if (path) return path;
        } else if (selected === 1) await gatewayManager(screen, io);
        else if (selected === 2) await settings(screen, store, io.signal);
        else return undefined;
      }
    }
  } finally { screen.leave(); }
}

export async function selectTerminalPermissionPath(request: RuntimePathRequest, signal: AbortSignal, io: TerminalIo = {}) {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr, false);
  screen.enter();
  try { return await selectPath(screen, { title: request.kind === "document" ? "选择文档" : "选择文件", extensions: request.extensions, mode: request.mode }, signal); }
  finally { screen.leave(); }
}

export async function promptTerminalTrust(request: RuntimeTrustRequest, io: TerminalIo = {}): Promise<RuntimeTrustDecision> {
  const screen = new TerminalScreen(io.input ?? process.stdin, io.output ?? process.stderr, false);
  screen.enter();
  try {
    const lines = [
      request.signature ? `签名发布者：${request.signature.keyId}` : "警告：此 bundle 未签名，无法确认发布者身份。",
      `类型：${request.kind}`,
      `ID：${request.bundleId}`,
      `版本：${request.version}`,
      `包哈希：${request.packageHash.slice(0, 32)}…`,
      `Integrity：${request.integrity}`,
      `权限：${request.permissions.join("、") || "无"}`,
      "",
      "是否信任并记住此授权？",
    ];
    for (;;) {
      screen.paint("Runtime Bundle 授权", lines, "Y 信任  ·  N 拒绝");
      const { text, key } = await screen.key(io.signal);
      if (interrupted(key)) throw new DOMException("Interrupted", "AbortError");
      if (key.name === "escape" || text?.toLowerCase() === "n") return { trusted: false };
      if (text?.toLowerCase() === "y") return { trusted: true, allowUnsigned: !request.signature, grants: [...request.permissions] };
    }
  } finally { screen.leave(); }
}
