import type { LocalRuntimeConfigStore } from "../local-config.ts";
import { TerminalScreen } from "../terminal-app.ts";

export async function manageTerminalKeys(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal) {
  let selected = 0; let message = "";
  for (;;) {
    const keys = Object.entries(await store.trustedKeys()).sort(([a], [b]) => a.localeCompare(b)); selected = Math.min(selected, Math.max(0, keys.length - 1));
    const lines = keys.length ? keys.map(([id], index) => `${index === selected ? "›" : " "} ${id}`) : ["  暂无可信发布者"]; if (message) lines.push("", message);
    screen.paint("Runtime 设置 · 可信发布者", lines, "N 添加  ·  D 删除  ·  Q 返回"); const { text, key } = await screen.key(signal);
    const action = await applyKeyCommand(screen, store, keys, selected, text, key, signal); if (action.done) return; selected = action.selected; if (action.message !== undefined) message = action.message;
  }
}

async function applyKeyCommand(screen: TerminalScreen, store: LocalRuntimeConfigStore, keys: [string, string][], selected: number, text: string, key: { name?: string; ctrl?: boolean }, signal?: AbortSignal) {
  if (key.ctrl && key.name === "c") throw new DOMException("Interrupted", "AbortError");
  if (key.name === "escape" || text?.toLowerCase() === "q") return { selected, done: true };
  if (key.name === "up" && keys.length) return { selected: (selected + keys.length - 1) % keys.length, done: false };
  if (key.name === "down" && keys.length) return { selected: (selected + 1) % keys.length, done: false };
  if (text?.toLowerCase() === "n") { const id = await screen.prompt("可信发布者", "keyId", signal); const value = id ? await screen.prompt("可信发布者", "base64 Ed25519 public key", signal) : undefined; if (!id || !value) return { selected, done: false }; try { await store.saveTrustedKey(id, value); return { selected, done: false, message: "公钥已保存" }; } catch (error) { return { selected, done: false, message: error instanceof Error ? error.message : String(error) }; } }
  if (text?.toLowerCase() === "d" && keys[selected]) { await store.removeTrustedKey(keys[selected][0]); return { selected: Math.max(0, selected - 1), done: false, message: "公钥已删除" }; }
  return { selected, done: false };
}

export async function manageTerminalTrust(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal) {
  let selected = 0;
  for (;;) {
    const records = (await store.listTrustRecords()).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt)); selected = Math.min(selected, Math.max(0, records.length - 1));
    screen.paint("Runtime 设置 · Bundle 授权", records.length ? records.map((item, index) => `${index === selected ? "›" : " "} ${item.bundleId} · ${item.kind} · ${item.permissions.join(", ") || "无权限"}`) : ["  暂无授权记录"], "D 撤销  ·  Q 返回"); const { text, key } = await screen.key(signal);
    if (key.ctrl && key.name === "c") throw new DOMException("Interrupted", "AbortError"); if (key.name === "escape" || text?.toLowerCase() === "q") return;
    if (key.name === "up" && records.length) selected = (selected + records.length - 1) % records.length; else if (key.name === "down" && records.length) selected = (selected + 1) % records.length;
    else if (text?.toLowerCase() === "d" && records[selected]) { await store.revokeTrustRecord(records[selected].key); selected = Math.max(0, selected - 1); }
  }
}
