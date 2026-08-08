import type { Key } from "node:readline";
import type { AiAppHandle, AiSessionHandle } from "../runtime-types.ts";
import { importKnowledgeFiles } from "./KnowledgeImportController.ts";
import { KnowledgeListController } from "./KnowledgeListController.ts";
import { KnowledgeScopeController } from "./KnowledgeScopeController.ts";

export type TerminalUiScreen = { paint(title: string, lines: string[], footer: string): void; key(signal?: AbortSignal): Promise<{ text: string; key: Key }> };

export async function manageTerminalKnowledge(screen: TerminalUiScreen, app: AiAppHandle, session: AiSessionHandle, signal?: AbortSignal) {
  const scopes = new KnowledgeScopeController(app.interaction?.knowledge?.scopes ?? ["app"], session.id);
  const list = new KnowledgeListController();
  for (;;) {
    const documents = await app.listKnowledge(scopes.value);
    list.normalize(documents);
    screen.paint(`${app.name} · 知识库 · ${scopes.label}`, list.lines(documents), "U 上传  ·  R 重新索引  ·  D 删除  ·  Tab 切换作用域  ·  ↑↓ 选择  ·  Q 返回");
    const { text, key } = await screen.key(signal);
    if (key.ctrl && key.name === "c") throw new DOMException("Interrupted", "AbortError");
    const command = key.name === "escape" ? "q" : key.name === "up" || key.name === "down" || key.name === "tab" ? key.name : (text ?? "").toLowerCase();
    if (command === "q") return;
    const handlers: Record<string, () => void | Promise<void>> = {
      up: () => list.move(-1, documents.length), down: () => list.move(1, documents.length), tab: () => scopes.toggle(),
      d: () => list.remove(app, documents, scopes.value), r: () => list.reindex(screen, app, documents, scopes.value, signal),
      u: async () => { list.message = await importKnowledgeFiles(screen, app, scopes.value, signal) ?? list.message; },
    };
    await handlers[command]?.();
  }
}
