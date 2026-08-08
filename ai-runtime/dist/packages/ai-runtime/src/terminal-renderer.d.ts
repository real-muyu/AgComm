import type { RuntimeRenderer } from "./renderer.ts";
import { type TerminalSessionInput, type TerminalSessionOutput } from "./tui/renderer/TerminalSession.ts";
export type TerminalInput = TerminalSessionInput;
export type TerminalOutput = TerminalSessionOutput & {
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
export { sanitizeTerminalText } from "./tui/renderer/TerminalText.ts";
export declare function createTerminalRenderer(options?: TerminalRendererOptions): RuntimeRenderer;
