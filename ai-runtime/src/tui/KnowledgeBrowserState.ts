import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Key } from "node:readline";

export type KnowledgeBrowserItem = { name: string; directory: boolean; path: string };

export class KnowledgeBrowserState {
  directory = process.cwd();
  selected = 0;
  readonly chosen = new Set<string>();

  async items(): Promise<KnowledgeBrowserItem[]> {
    const entries = (await readdir(this.directory, { withFileTypes: true }))
      .filter((item) => item.isDirectory() || item.isFile())
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const items = [{ name: "..", directory: true, path: dirname(this.directory) }, ...entries.map((item) => ({ name: item.name, directory: item.isDirectory(), path: resolve(this.directory, item.name) }))];
    this.selected = Math.min(this.selected, items.length - 1);
    return items;
  }

  move(delta: number, count: number) { this.selected = (this.selected + count + delta) % count; }
  parent() { this.directory = dirname(this.directory); this.selected = 0; }
  enter(item: KnowledgeBrowserItem) { if (item.directory) { this.directory = item.path; this.selected = 0; } }
  toggle(item: KnowledgeBrowserItem) { if (item.directory) return; if (this.chosen.has(item.path)) this.chosen.delete(item.path); else this.chosen.add(item.path); }
  command(text: string | undefined, key: Key, items: readonly KnowledgeBrowserItem[]) {
    const value = (text ?? "").toLowerCase();
    if (key.name === "escape" || value === "q") return "cancel" as const;
    if (value === "u" && this.chosen.size) return "import" as const;
    const handlers: Record<string, () => void> = {
      up: () => this.move(-1, items.length), down: () => this.move(1, items.length), backspace: () => this.parent(),
      return: () => this.enter(items[this.selected]), space: () => this.toggle(items[this.selected]),
    };
    handlers[key.name ?? ""]?.();
    return "continue" as const;
  }
}
