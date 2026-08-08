import type { AiAppHandle, AiSessionHandle } from "../runtime-types.ts";
import type { TerminalScreen } from "../terminal-app.ts";
export declare class SessionPickerController {
    private readonly state;
    run(screen: TerminalScreen, app: AiAppHandle, signal?: AbortSignal): Promise<AiSessionHandle | undefined>;
}
