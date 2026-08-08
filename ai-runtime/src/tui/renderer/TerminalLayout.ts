import type { RuntimeInputField, RuntimeInputRequest } from "../../renderer.ts";

export type TerminalGridCell = { field: RuntimeInputField; index: number; span: number };

function spanFor(field: RuntimeInputField, layout: RuntimeInputRequest["form"]["layout"], narrow: boolean): number {
  if (narrow || layout === "single") return 6;
  if (layout === "two-column") return field.size === "large" ? 6 : 3;
  return field.size === "large" ? 6 : field.size === "medium" ? 4 : 2;
}

export function terminalGridRows(
  fields: RuntimeInputField[],
  layout: RuntimeInputRequest["form"]["layout"],
  narrow: boolean,
): TerminalGridCell[][] {
  const rows: TerminalGridCell[][] = [];
  let row: TerminalGridCell[] = [];
  let used = 0;
  fields.forEach((field, index) => {
    const span = spanFor(field, layout, narrow);
    if (used && used + span > 6) { rows.push(row); row = []; used = 0; }
    row.push({ field, index, span });
    used += span;
    if (used === 6) { rows.push(row); row = []; used = 0; }
  });
  if (row.length) rows.push(row);
  return rows;
}
