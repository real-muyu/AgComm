import type { Key } from "node:readline";
import type { TerminalInput, TerminalOutput } from "../terminal-renderer.ts";
export interface TerminalScreenPort {
    readonly input: TerminalInput;
    readonly output: TerminalOutput;
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
