import type { AiAppHandle } from "../runtime-types.ts";
import type { KnowledgeDocument, KnowledgeScope } from "../app-storage.ts";
import type { TerminalUiScreen } from "./KnowledgeController.ts";
export declare class KnowledgeListController {
    selected: number;
    message: string;
    normalize(documents: readonly KnowledgeDocument[]): void;
    move(delta: number, count: number): void;
    lines(documents: readonly KnowledgeDocument[]): string[];
    remove(app: AiAppHandle, documents: readonly KnowledgeDocument[], scope: KnowledgeScope): Promise<void>;
    reindex(screen: TerminalUiScreen, app: AiAppHandle, documents: readonly KnowledgeDocument[], scope: KnowledgeScope, signal?: AbortSignal): Promise<void>;
}
