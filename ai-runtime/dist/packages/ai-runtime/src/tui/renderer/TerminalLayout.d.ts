import type { RuntimeInputField, RuntimeInputRequest } from "../../renderer.ts";
export type TerminalGridCell = {
    field: RuntimeInputField;
    index: number;
    span: number;
};
export declare function terminalGridRows(fields: RuntimeInputField[], layout: RuntimeInputRequest["form"]["layout"], narrow: boolean): TerminalGridCell[][];
