import type { Key } from "node:readline";
export type TerminalSessionInput = NodeJS.ReadableStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?(mode: boolean): void;
};
export type TerminalSessionOutput = NodeJS.WritableStream & {
    isTTY?: boolean;
    on?(event: string, listener: (...args: any[]) => void): unknown;
    off?(event: string, listener: (...args: any[]) => void): unknown;
};
type KeyHandler = (text: string, key: Key) => void;
export declare class TerminalSession {
    private readonly input;
    private readonly output;
    private readonly color;
    private readonly onResize;
    private entered;
    private previousRaw;
    private previouslyPaused;
    private previousDataListeners;
    private handler?;
    private abortCleanup?;
    constructor(input: TerminalSessionInput, output: TerminalSessionOutput, color: boolean, onResize: () => void);
    enter(): void;
    bind(handler: KeyHandler, signal?: AbortSignal): () => void;
    unbind(): void;
    get active(): boolean;
    dispose(): void;
}
export {};
