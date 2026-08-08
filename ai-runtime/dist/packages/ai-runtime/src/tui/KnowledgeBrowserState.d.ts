import type { Key } from "node:readline";
export type KnowledgeBrowserItem = {
    name: string;
    directory: boolean;
    path: string;
};
export declare class KnowledgeBrowserState {
    directory: string;
    selected: number;
    readonly chosen: Set<string>;
    items(): Promise<KnowledgeBrowserItem[]>;
    move(delta: number, count: number): void;
    parent(): void;
    enter(item: KnowledgeBrowserItem): void;
    toggle(item: KnowledgeBrowserItem): void;
    command(text: string | undefined, key: Key, items: readonly KnowledgeBrowserItem[]): "continue" | "cancel" | "import";
}
