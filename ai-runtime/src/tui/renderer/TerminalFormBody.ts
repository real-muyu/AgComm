import type { RuntimeInputField, RuntimeInputRequest } from "../../renderer.ts";
import { terminalGridRows, type TerminalGridCell } from "./TerminalLayout.ts";
import type { TerminalFormState } from "./TerminalFormController.ts";
import type { TerminalFormViewStyle } from "./TerminalFormViewStyle.ts";
import { padTerminalText as pad, sanitizeTerminalText } from "./TerminalText.ts";

export type TerminalFormBody = {
  lines: string[];
  ranges: Map<number, { start: number; end: number }>;
};

function fieldValueLine(field: RuntimeInputField, value: unknown, selected: boolean, form: TerminalFormState): string {
  if (field.component === "checkbox") return value === true || value === "true" ? "●  已选择" : "○  未选择";
  if (field.component === "button") {
    return `${String(value) === (field.buttonValue ?? "true") ? "✓" : "→"}  ${sanitizeTerminalText(field.buttonValue ?? "true", false)}`;
  }
  const editing = form.editing?.index === form.focus && selected ? form.editing.buffer : value;
  return sanitizeTerminalText(editing ?? field.placeholder ?? "输入内容", false);
}

function cellLines(
  cell: TerminalGridCell,
  width: number,
  form: TerminalFormState,
  style: TerminalFormViewStyle,
): string[] {
  const { field, index } = cell;
  const selected = form.focus === index;
  const label = `${selected ? "│" : " "} ${sanitizeTerminalText(field.label, false)}`;
  const meta = `  ${sanitizeTerminalText(field.variable, false)} · ${sanitizeTerminalText(field.variableType, false)}`;
  const value = `  ${fieldValueLine(field, form.values[field.variable], selected, form)}`;
  return [
    selected ? style.accent(pad(label, width)) : style.bold(pad(label, width)),
    style.muted(pad(meta, width)),
    selected ? style.accent(pad(value, width)) : pad(value, width),
  ];
}

function appendGridRow(
  body: TerminalFormBody,
  row: TerminalGridCell[],
  width: number,
  form: TerminalFormState,
  style: TerminalFormViewStyle,
): void {
  const usable = Math.max(18, width - (row.length - 1) * 2);
  const widths = row.map(({ span }) => Math.max(8, Math.floor(usable * span / 6)));
  const cells = row.map((cell, index) => cellLines(cell, widths[index], form, style));
  const start = body.lines.length;
  for (let line = 0; line < 3; line++) body.lines.push(cells.map((cell) => cell[line]).join("  "));
  body.lines.push("");
  for (const { index } of row) body.ranges.set(index, { start, end: body.lines.length - 1 });
}

export function buildTerminalFormBody(
  request: RuntimeInputRequest,
  form: TerminalFormState,
  columns: number,
  width: number,
  style: TerminalFormViewStyle,
): TerminalFormBody {
  const body: TerminalFormBody = { lines: [], ranges: new Map() };
  for (const row of terminalGridRows(request.form.fields, request.form.layout, columns < 72)) {
    appendGridRow(body, row, width, form, style);
  }
  const submitIndex = request.form.fields.length;
  const submitStart = body.lines.length;
  body.lines.push(form.submitSelected ? style.accent("│ Continue  写入变量并继续") : "  Continue  写入变量并继续");
  body.ranges.set(submitIndex, { start: submitStart, end: submitStart });
  return body;
}
