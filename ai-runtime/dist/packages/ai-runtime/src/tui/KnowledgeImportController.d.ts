import type { AiAppHandle } from "../runtime-types.ts";
import type { KnowledgeScope } from "../app-storage.ts";
import type { TerminalUiScreen } from "./KnowledgeController.ts";
export declare function browseKnowledgeFiles(screen: TerminalUiScreen, signal?: AbortSignal): Promise<string[]>;
export declare function importKnowledgeFiles(screen: TerminalUiScreen, app: AiAppHandle, scope: KnowledgeScope, signal?: AbortSignal): Promise<string | undefined>;
