import type { Key } from "node:readline";
import type { RuntimeInputField } from "../../renderer.ts";
export type TerminalFormEditing = {
    index: number;
    buffer: string;
    cursor: number;
    multiline: boolean;
};
export declare class TerminalFormState {
    readonly fields: readonly RuntimeInputField[];
    readonly values: Record<string, unknown>;
    focus: number;
    editing?: TerminalFormEditing;
    viewportStart: number;
    validationError: string;
    constructor(fields: readonly RuntimeInputField[], initial: Readonly<Record<string, unknown>>, validationError?: string);
    get selected(): RuntimeInputField;
    get submitSelected(): boolean;
    move(delta: number): void;
    commit(): void;
    cancelEdit(): void;
    startEdit(): boolean;
}
export type TerminalFormAction = "redraw" | "submit" | "abort" | "idle";
/** Converts keypresses to deterministic form state transitions. */
export declare function handleTerminalFormKey(state: TerminalFormState, text: string, key: Key): TerminalFormAction;
