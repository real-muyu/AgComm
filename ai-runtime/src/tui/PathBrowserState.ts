import { readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

export type PathBrowserItem = { name: string; isDirectory(): boolean };

export class PathBrowserState {
  directory: string;
  selected = 0;
  items: PathBrowserItem[] = [];

  constructor(initialDirectory: string, private readonly extensions: ReadonlySet<string>) {
    this.directory = resolve(initialDirectory);
  }

  async refresh() {
    const entries = (await readdir(this.directory, { withFileTypes: true }))
      .filter((item) => item.isDirectory() || (item.isFile() && (!this.extensions.size || this.extensions.has(extname(item.name).toLowerCase()))))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    this.items = [{ name: "..", isDirectory: () => true }, ...entries];
    this.selected = Math.min(this.selected, this.items.length - 1);
  }

  move(offset: -1 | 1) { this.selected = (this.selected + this.items.length + offset) % this.items.length; }
  parent() { this.directory = dirname(this.directory); this.selected = 0; }
  open() {
    const item = this.items[this.selected];
    const path = resolve(this.directory, item.name);
    if (!item.isDirectory()) return path;
    this.directory = path;
    this.selected = 0;
    return undefined;
  }
  rows() { return this.items.map((item, index) => `${index === this.selected ? "›" : " "} ${item.isDirectory() ? "▸" : " "} ${item.name}`); }
}
