import type { LocalRuntimeConfigStore } from "../local-config.ts";
import { TerminalScreen } from "../terminal-app.ts";
export declare function manageTerminalKeys(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal): Promise<void>;
export declare function manageTerminalTrust(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal): Promise<void>;
