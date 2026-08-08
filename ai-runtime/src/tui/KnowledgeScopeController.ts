import type { KnowledgeScope } from "../app-storage.ts";

export class KnowledgeScopeController {
  private scopeValue: KnowledgeScope;
  constructor(private readonly enabled: readonly ("app" | "session")[], private readonly sessionId: string) {
    this.scopeValue = enabled.includes("app") ? { type: "app" } : { type: "session", sessionId };
  }
  get value() { return this.scopeValue; }
  get label() { return this.scopeValue.type === "app" ? "应用级" : "会话级"; }
  toggle() { if (this.enabled.length > 1) this.scopeValue = this.scopeValue.type === "app" ? { type: "session", sessionId: this.sessionId } : { type: "app" }; }
}
