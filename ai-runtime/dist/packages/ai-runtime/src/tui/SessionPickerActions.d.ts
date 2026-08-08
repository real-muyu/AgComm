import type { AiAppHandle, AiSessionHandle } from "../runtime-types.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { SessionPickerItem } from "./SessionPickerState.ts";
export declare function openSelectedSession(app: AiAppHandle, item: SessionPickerItem): Promise<AiSessionHandle>;
export declare function renameSelectedSession(screen: TerminalScreen, app: AiAppHandle, item: SessionPickerItem, signal?: AbortSignal): Promise<void>;
