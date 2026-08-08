import type { TerminalFormState } from "./TerminalFormController.ts";
import type { TerminalFormBody } from "./TerminalFormBody.ts";
import type { TerminalFormViewStyle } from "./TerminalFormViewStyle.ts";

export function terminalFormViewport(
  body: TerminalFormBody,
  form: TerminalFormState,
  available: number,
  margin: string,
  style: TerminalFormViewStyle,
): string[] {
  updateViewport(body, form, available);
  const hasPrevious = form.viewportStart > 0;
  const hasNext = form.viewportStart + available < body.lines.length;
  const visibleCount = Math.max(1, available - Number(hasPrevious) - Number(hasNext));
  const lines: string[] = [];
  if (hasPrevious) lines.push(`${margin}${style.muted("↑ 更多字段")}`);
  lines.push(...body.lines.slice(form.viewportStart, form.viewportStart + visibleCount).map((line) => `${margin}${line}`));
  if (form.viewportStart + visibleCount < body.lines.length) lines.push(`${margin}${style.muted("↓ 更多字段")}`);
  return lines;
}

function updateViewport(body: TerminalFormBody, form: TerminalFormState, available: number): void {
  const focused = body.ranges.get(form.focus) ?? { start: 0, end: 0 };
  if (focused.start < form.viewportStart) form.viewportStart = focused.start;
  if (focused.end >= form.viewportStart + available) form.viewportStart = focused.end - available + 1;
  form.viewportStart = Math.max(0, Math.min(form.viewportStart, Math.max(0, body.lines.length - available)));
}
