import type { LocalRuntimeConfigStore } from "../local-config.ts";
import { TerminalScreen } from "../terminal-app.ts";
export declare function manageTerminalProviders(screen: TerminalScreen, store: LocalRuntimeConfigStore, signal?: AbortSignal): Promise<void>;
