import type { LocalRuntimeConfigStore, ProviderProfile } from "../local-config.ts";
import { TerminalScreen } from "../terminal-app.ts";

async function editProvider(screen: TerminalScreen, store: LocalRuntimeConfigStore, existing?: ProviderProfile, signal?: AbortSignal) {
  const id = existing?.id ?? await screen.prompt("Provider", "唯一 ID（字母、数字、下划线或连字符）", signal); if (!id) return;
  const label = await screen.prompt("Provider", `名称${existing ? `（当前：${existing.label}）` : ""}`, signal); if (label === undefined) return;
  const baseUrl = await screen.prompt("Provider", `Base URL${existing ? `（当前：${existing.baseUrl}）` : "，默认 https://api.openai.com/v1"}`, signal); if (baseUrl === undefined) return;
  const model = await screen.prompt("Provider", `模型${existing ? `（当前：${existing.model}）` : "，默认 gpt-4.1-mini"}`, signal); if (model === undefined) return;
  const embeddingModel = await screen.prompt("Provider", `Embedding 模型${existing?.embeddingModel ? `（当前：${existing.embeddingModel}）` : "（可留空）"}`, signal); if (embeddingModel === undefined) return;
  const secret = await screen.prompt("Provider", existing ? "API Key（留空表示不修改）" : "API Key", signal, { secret: true }); if (secret === undefined || (!existing && !secret)) return;
  await store.saveProfile({ id, label: label || existing?.label || id, baseUrl: baseUrl || existing?.baseUrl || "https://api.openai.com/v1", model: model || existing?.model || "gpt-4.1-mini", ...(embeddingModel || existing?.embeddingModel ? { embeddingModel: embeddingModel || existing?.embeddingModel } : {}) }, secret || undefined);
}

export async function manageTerminalProviders(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal) {
  let selected = 0; let message = "";
  for (;;) {
    const config = await store.load(); const profiles = config.providers; selected = Math.min(selected, Math.max(0, profiles.length - 1));
    const lines = profiles.length ? profiles.map((item, index) => `${index === selected ? "›" : " "} ${item.id === config.selectedProviderId ? "●" : "○"} ${item.label} · ${item.model}`) : ["  暂无 Provider"]; if (message) lines.push("", message);
    screen.paint("Runtime 设置 · Provider", lines, "N 新建  ·  E 编辑  ·  Enter 设为默认  ·  D 删除  ·  Q 返回"); const { text, key } = await screen.key(signal);
    const action = await applyProviderKey({ screen, store, profiles, selected, text, key, signal });
    if (action.done) return; selected = action.selected; if (action.message !== undefined) message = action.message;
  }
}

async function applyProviderKey(input: { screen: TerminalScreen; store: LocalRuntimeConfigStore; profiles: ProviderProfile[]; selected: number; text: string; key: { name?: string; ctrl?: boolean }; signal?: AbortSignal }) {
  const { screen, store, profiles, text, key, signal } = input; let selected = input.selected;
  if (key.ctrl && key.name === "c") throw new DOMException("Interrupted", "AbortError");
  if (key.name === "escape" || text?.toLowerCase() === "q") return { selected, done: true };
  if (key.name === "up" && profiles.length) return { selected: (selected + profiles.length - 1) % profiles.length, done: false };
  if (key.name === "down" && profiles.length) return { selected: (selected + 1) % profiles.length, done: false };
  try {
    if (text?.toLowerCase() === "n") { await editProvider(screen, store, undefined, signal); return { selected, done: false, message: "Provider 已保存" }; }
    if (text?.toLowerCase() === "e" && profiles[selected]) { await editProvider(screen, store, profiles[selected], signal); return { selected, done: false, message: "Provider 已更新" }; }
    if (key.name === "return" && profiles[selected]) { await store.selectProfile(profiles[selected].id); return { selected, done: false, message: "已设为默认 Provider" }; }
    if (text?.toLowerCase() === "d" && profiles[selected]) { await store.deleteProfile(profiles[selected].id); selected = Math.max(0, selected - 1); return { selected, done: false, message: "Provider 已删除" }; }
  } catch (error) { return { selected, done: false, message: error instanceof Error ? error.message : String(error) }; }
  return { selected, done: false };
}
