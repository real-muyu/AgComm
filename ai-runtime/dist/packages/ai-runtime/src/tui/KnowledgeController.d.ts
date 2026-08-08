import type { Key } from "node:readline";
import type { AiAppHandle, AiSessionHandle } from "../runtime-types.ts";
export type TerminalUiScreen = {
    paint(title: string, lines: string[], footer: string): void;
    key(signal?: AbortSignal): Promise<{
        text: string;
        key: Key;
    }>;
};
export declare function manageTerminalKnowledge(screen: TerminalUiScreen, app: AiAppHandle, session: AiSessionHandle, signal?: AbortSignal): Promise<void>;
