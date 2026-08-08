import type { KnowledgeScope } from "../app-storage.ts";
export declare class KnowledgeScopeController {
    private readonly enabled;
    private readonly sessionId;
    private scopeValue;
    constructor(enabled: readonly ("app" | "session")[], sessionId: string);
    get value(): KnowledgeScope;
    get label(): "应用级" | "会话级";
    toggle(): void;
}
