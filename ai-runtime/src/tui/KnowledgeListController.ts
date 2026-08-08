import type { AiAppHandle } from "../runtime-types.ts";
import type { KnowledgeDocument, KnowledgeScope } from "../app-storage.ts";
import type { TerminalUiScreen } from "./KnowledgeController.ts";

export class KnowledgeListController {
  selected = 0;
  message = "";
  normalize(documents: readonly KnowledgeDocument[]) { this.selected = Math.min(this.selected, Math.max(0, documents.length - 1)); }
  move(delta: number, count: number) { if (count) this.selected = (this.selected + count + delta) % count; }
  lines(documents: readonly KnowledgeDocument[]) { const lines = documents.length ? documents.map((item, index) => `${index === this.selected ? "›" : " "} ${item.status === "ready" ? "●" : "!"} ${item.name} · ${item.chunkCount} chunks`) : ["  暂无知识文件"]; if (this.message) lines.push("", this.message); return lines; }
  async remove(app: AiAppHandle, documents: readonly KnowledgeDocument[], scope: KnowledgeScope) { const selected = documents[this.selected]; if (!selected) return; await app.removeKnowledge([selected.id], scope); this.message = "已删除"; }
  async reindex(screen: TerminalUiScreen, app: AiAppHandle, documents: readonly KnowledgeDocument[], scope: KnowledgeScope, signal?: AbortSignal) {
    if (!documents.length) return;
    screen.paint(app.name, ["正在重新索引知识库…"], "请稍候");
    try { this.message = `已重新索引 ${(await app.reindexKnowledge(undefined, { scope, signal })).length} 个文件`; } catch (error) { this.message = `重新索引失败：${error instanceof Error ? error.message : String(error)}`; }
  }
}
