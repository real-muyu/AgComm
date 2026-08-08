import { type Key } from "node:readline";
import type { AiAppHandle } from "./runtime-types.ts";
import { type TerminalInput, type TerminalOutput } from "./terminal-renderer.ts";
export type TerminalAppOptions = {
    input?: TerminalInput;
    output?: TerminalOutput;
    initialInput?: string;
    variables?: Record<string, unknown>;
    signal?: AbortSignal;
    formatError?: (error: unknown) => string;
    openSettings?: () => Promise<void>;
};
export declare class TerminalScreen {
    readonly input: TerminalInput;
    readonly output: TerminalOutput;
    private readonly alternate;
    private entered;
    private previousRaw;
    private previouslyPaused;
    private pendingKey?;
    constructor(input: TerminalInput, output: TerminalOutput, alternate?: boolean);
    enter(): void;
    leave(): void;
    paint(title: string, lines: string[], footer: string): void;
    key(signal?: AbortSignal): Promise<{
        text: string;
        key: Key;
    }>;
    prompt(title: string, label: string, signal?: AbortSignal, options?: {
        secret?: boolean;
    }): Promise<string | undefined>;
}
export declare function runTerminalApp(app: AiAppHandle, options?: TerminalAppOptions): Promise<void>;
