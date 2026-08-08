import type { Key } from "node:readline";
import type { RuntimeInputField } from "../../renderer.ts";
import { editableTerminalValue, isTerminalSubmitKey } from "./TerminalInputModel.ts";
import { sanitizeTerminalText } from "./TerminalText.ts";

const MAX_FIELD_CHARS = 65_536;

export type TerminalFormEditing = { index: number; buffer: string; cursor: number; multiline: boolean };
export class TerminalFormState {
  readonly values: Record<string, unknown>;
  focus = 0;
  editing?: TerminalFormEditing;
  viewportStart = 0;
  validationError: string;
  constructor(readonly fields: readonly RuntimeInputField[], initial: Readonly<Record<string, unknown>>, validationError = "") {
    this.values = Object.fromEntries(fields.map((field) => [field.variable, initial[field.variable]]));
    this.validationError = validationError;
  }
  get selected() { return this.fields[this.focus]; }
  get submitSelected() { return this.focus === this.fields.length; }
  move(delta: number) { const count = this.fields.length + 1; this.focus = (this.focus + delta + count) % count; }
  commit() { if (this.editing) this.values[this.fields[this.editing.index].variable] = this.editing.buffer; this.editing = undefined; this.validationError = ""; }
  cancelEdit() { this.editing = undefined; }
  startEdit() {
    const field = this.selected;
    if (!field || field.component !== "input") return false;
    const buffer = editableTerminalValue(field, this.values[field.variable]);
    this.editing = { index: this.focus, buffer, cursor: buffer.length, multiline: ["markdown", "array", "object"].includes(field.variableType.toLowerCase()) };
    return true;
  }
}

export type TerminalFormAction = "redraw" | "submit" | "abort" | "idle";

function handleEditingKey(state: TerminalFormState, text: string, key: Key): TerminalFormAction {
  const editing = state.editing!;
  if (key.name === "f2" || (!editing.multiline && key.name === "return")) { state.commit(); return "redraw"; }
  if (key.name === "escape") { state.cancelEdit(); return "redraw"; }
  if (editing.multiline && key.name === "return") { editing.buffer = `${editing.buffer.slice(0, editing.cursor)}\n${editing.buffer.slice(editing.cursor)}`.slice(0, MAX_FIELD_CHARS); editing.cursor++; return "redraw"; }
  if (key.name === "backspace") { if (editing.cursor > 0) { editing.buffer = editing.buffer.slice(0, editing.cursor - 1) + editing.buffer.slice(editing.cursor); editing.cursor--; } return "redraw"; }
  if (key.name === "delete") { editing.buffer = editing.buffer.slice(0, editing.cursor) + editing.buffer.slice(editing.cursor + 1); return "redraw"; }
  if (key.name === "left") { editing.cursor = Math.max(0, editing.cursor - 1); return "redraw"; }
  if (key.name === "right") { editing.cursor = Math.min(editing.buffer.length, editing.cursor + 1); return "redraw"; }
  if (key.name === "home") { editing.cursor = 0; return "redraw"; }
  if (key.name === "end") { editing.cursor = editing.buffer.length; return "redraw"; }
  if (!text || key.ctrl || key.meta) return "idle";
  const inserted = sanitizeTerminalText(text, editing.multiline).slice(0, MAX_FIELD_CHARS - editing.buffer.length);
  editing.buffer = editing.buffer.slice(0, editing.cursor) + inserted + editing.buffer.slice(editing.cursor); editing.cursor += inserted.length;
  return "redraw";
}

function handleSelectionKey(state: TerminalFormState, key: Key): TerminalFormAction {
  if (key.name === "tab" || key.name === "right" || key.name === "down") { state.move(key.shift ? -1 : 1); return "redraw"; }
  if (key.name === "left" || key.name === "up") { state.move(-1); return "redraw"; }
  if (state.submitSelected && key.name === "return") return "submit";
  const field = state.selected;
  if (!field) return "idle";
  if (field.component === "checkbox" && (key.name === "space" || key.name === "return")) { state.values[field.variable] = !(state.values[field.variable] === true || state.values[field.variable] === "true"); state.validationError = ""; return "redraw"; }
  if (field.component === "button" && (key.name === "space" || key.name === "return")) { state.values[field.variable] = field.buttonValue ?? "true"; state.validationError = ""; return "redraw"; }
  return key.name === "return" && state.startEdit() ? "redraw" : "idle";
}

/** Converts keypresses to deterministic form state transitions. */
export function handleTerminalFormKey(state: TerminalFormState, text: string, key: Key): TerminalFormAction {
  if (key.ctrl && (key.name === "c" || key.name === "escape")) return "abort";
  if (isTerminalSubmitKey(text, key)) { state.commit(); return "submit"; }
  return state.editing ? handleEditingKey(state, text, key) : handleSelectionKey(state, key);
}
