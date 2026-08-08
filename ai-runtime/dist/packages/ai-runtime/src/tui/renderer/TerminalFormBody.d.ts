import type { RuntimeInputRequest } from "../../renderer.ts";
import type { TerminalFormState } from "./TerminalFormController.ts";
import type { TerminalFormViewStyle } from "./TerminalFormViewStyle.ts";
export type TerminalFormBody = {
    lines: string[];
    ranges: Map<number, {
        start: number;
        end: number;
    }>;
};
export declare function buildTerminalFormBody(request: RuntimeInputRequest, form: TerminalFormState, columns: number, width: number, style: TerminalFormViewStyle): TerminalFormBody;
