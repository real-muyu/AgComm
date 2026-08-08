import type { RuntimeInputRequest } from "../../renderer.ts";
import type { TerminalFormState } from "./TerminalFormController.ts";
import type { TerminalFormViewStyle } from "./TerminalFormViewStyle.ts";
export type { TerminalFormViewStyle } from "./TerminalFormViewStyle.ts";
export declare function renderTerminalForm(request: RuntimeInputRequest, form: TerminalFormState, layout: {
    columns: number;
    rows: number;
    width: number;
    margin: string;
}, style: TerminalFormViewStyle): string[];
