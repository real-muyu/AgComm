import type { GatewayClientLike } from "../gateway-loader.ts";

export type GatewayInboxItem = Awaited<ReturnType<GatewayClientLike["listInbox"]>>[number];

export class GatewayInboxState {
  #selected = 0;
  #items: GatewayInboxItem[] = [];

  get current(): GatewayInboxItem | undefined {
    return this.#items[this.#selected];
  }

  update(items: GatewayInboxItem[]): void {
    this.#items = items.slice(-100).reverse();
    this.#selected = Math.min(this.#selected, Math.max(0, this.#items.length - 1));
  }

  move(offset: number): void {
    if (this.#items.length === 0) return;
    this.#selected = (this.#selected + this.#items.length + offset) % this.#items.length;
  }

  lines(): string[] {
    const lines = this.#items.length
      ? this.#items.map((item, index) =>
        `${index === this.#selected ? "›" : " "} ${item.readAt ? "○" : "●"} ${item.title} · ${item.severity} · ${item.deliveryStatus}`,
      )
      : ["  Inbox 为空"];
    if (this.current) lines.push("", this.current.body, this.current.createdAt);
    return lines;
  }
}
