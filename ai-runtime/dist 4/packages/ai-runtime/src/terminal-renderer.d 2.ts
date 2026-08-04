import type { RuntimeRenderer } from "./renderer.ts";
export type TerminalInput = NodeJS.ReadableStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?(mode: boolean): void;
};
export type TerminalOutput = NodeJS.WritableStream & {
    isTTY?: boolean;
    columns?: number;
    rows?: number;
};
export type TerminalRendererOptions = {
    input?: TerminalInput;
    output?: TerminalOutput;
    color?: boolean;
    formatError?: (error: unknown) => string;
    waitOnComplete?: boolean;
};
export declare function sanitizeTerminalText(value: unknown, multiline?: boolean): string;
export declare function createTerminalRenderer(options?: TerminalRendererOptions): RuntimeRenderer;
