import type { RuntimeEvent } from "../../runtime-types.ts";
export type TerminalRuntimeUpdate = {
    phase?: string;
    activity?: string;
};
export declare function terminalRuntimeEvent(event: RuntimeEvent): TerminalRuntimeUpdate;
export declare function sanitizeRuntimeUpdate(update: TerminalRuntimeUpdate): TerminalRuntimeUpdate;
