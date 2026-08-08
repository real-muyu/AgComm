import type { SessionSummary } from "../app-storage.ts";

export type SessionPickerItem = Pick<SessionSummary, "id" | "title" | "messageCount">;

export class SessionPickerState {
  private items: SessionPickerItem[] = [];
  private selected = 0;

  update(sessions: readonly SessionSummary[]) {
    this.items = [{ id: "", title: "新建会话", messageCount: 0 }, ...sessions];
    this.selected = Math.min(this.selected, this.items.length - 1);
  }

  move(offset: -1 | 1) {
    this.selected = (this.selected + this.items.length + offset) % this.items.length;
  }

  selectedItem() {
    return this.items[this.selected];
  }

  selectedExisting() {
    const item = this.selectedItem();
    return item?.id ? item : undefined;
  }

  afterDelete() {
    this.selected = Math.max(0, this.selected - 1);
  }

  rows() {
    return this.items.map((item, index) => `${index === this.selected ? "›" : " "} ${item.title}${item.id ? `  ·  ${item.messageCount} 条消息` : ""}`);
  }
}
