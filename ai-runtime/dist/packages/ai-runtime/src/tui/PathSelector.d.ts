import { TerminalScreen } from "../terminal-app.ts";
export declare function selectTerminalPath(screen: TerminalScreen, options: {
    title: string;
    extensions?: readonly string[];
    mode?: "read" | "write";
    initialDirectory?: string;
}, signal?: AbortSignal): Promise<string | undefined>;
