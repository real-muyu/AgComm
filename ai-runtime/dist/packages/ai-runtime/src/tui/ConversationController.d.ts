import type { AiAppHandle, AiSessionHandle } from "../runtime-types.ts";
import type { TerminalInput, TerminalOutput } from "../terminal-renderer.ts";
import type { TerminalScreenPort } from "./TerminalScreenPort.ts";
type ConversationOptions = {
    input?: TerminalInput;
    output?: TerminalOutput;
    initialInput?: string;
    variables?: Record<string, unknown>;
    signal?: AbortSignal;
    formatError?: (error: unknown) => string;
    openSettings?: () => Promise<void>;
};
export declare class ConversationController {
    private readonly screen;
    private readonly app;
    private readonly session;
    private readonly options;
    constructor(screen: TerminalScreenPort, app: AiAppHandle, session: AiSessionHandle, options: ConversationOptions);
    run(): Promise<"quit" | "sessions">;
    private paint;
    private readCommand;
    private navigationCommand;
    private applyCommand;
    private openSettings;
    private runTurn;
}
export {};
