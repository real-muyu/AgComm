import { basename, dirname } from "node:path";
import type { AiAppHandle } from "../runtime-types.ts";
import type { KnowledgeScope } from "../app-storage.ts";
import { KnowledgeBrowserState } from "./KnowledgeBrowserState.ts";
import type { TerminalUiScreen } from "./KnowledgeController.ts";

export async function browseKnowledgeFiles(screen: TerminalUiScreen, signal?: AbortSignal) {
  const state = new KnowledgeBrowserState();
  for (;;) {
    let items;
    try { items = await state.items(); } catch { state.directory = dirname(state.directory); continue; }
    screen.paint(`知识文件 · ${state.directory}`, items.map((item, index) => `${index === state.selected ? "›" : " "} ${item.directory ? "▸" : state.chosen.has(item.path) ? "●" : "○"} ${item.name}`), `↑↓ 选择  ·  Enter 进入目录  ·  Space 多选  ·  U 导入 (${state.chosen.size})  ·  Q 返回`);
    const { text, key } = await screen.key(signal);
    if (key.ctrl && key.name === "c") throw new DOMException("Interrupted", "AbortError");
    const action = state.command(text === " " ? undefined : text, text === " " ? { ...key, name: "space" } : key, items);
    if (action === "cancel") return [];
    if (action === "import") return [...state.chosen];
  }
}

export async function importKnowledgeFiles(screen: TerminalUiScreen, app: AiAppHandle, scope: KnowledgeScope, signal?: AbortSignal) {
  const paths = await browseKnowledgeFiles(screen, signal);
  if (!paths.length) return undefined;
  screen.paint(app.name, paths.map((path) => `等待索引 ${basename(path)}…`), "请稍候");
  try {
    const documents = await app.importKnowledge(paths, { scope, signal, onProgress(progress) {
      const detail = progress.total === undefined ? progress.phase : `${progress.phase} ${progress.completed ?? 0}/${progress.total}`;
      screen.paint(app.name, [`${progress.fileIndex + 1}/${progress.fileCount} ${progress.name}`, detail, progress.message ?? ""].filter(Boolean), "正在构建本地向量索引");
    } });
    return `已索引 ${documents.length} 个文件`;
  } catch (error) { return `索引失败：${error instanceof Error ? error.message : String(error)}`; }
}
