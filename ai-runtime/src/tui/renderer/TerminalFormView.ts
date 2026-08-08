import type { RuntimeInputRequest } from "../../renderer.ts";
import { buildTerminalFormBody } from "./TerminalFormBody.ts";
import type { TerminalFormState } from "./TerminalFormController.ts";
import { terminalFormViewport } from "./TerminalFormViewport.ts";
import type { TerminalFormViewStyle } from "./TerminalFormViewStyle.ts";
import { cropTerminalText as crop, sanitizeTerminalText } from "./TerminalText.ts";

export type { TerminalFormViewStyle } from "./TerminalFormViewStyle.ts";

export function renderTerminalForm(
  request: RuntimeInputRequest,
  form: TerminalFormState,
  layout: { columns: number; rows: number; width: number; margin: string },
  style: TerminalFormViewStyle,
): string[] {
  const { columns, rows, width, margin } = layout;
  const body = buildTerminalFormBody(request, form, columns, width, style);
  const footerRows = form.editing || form.validationError ? 3 : 2;
  const available = Math.max(2, rows - 5 - footerRows);
  const lines = [
    "",
    ...style.header(`等待输入 · ${request.node.title}`),
    "",
    ...terminalFormViewport(body, form, available, margin, style),
    "",
    `${margin}${style.muted(formHelp(form))}`,
  ];
  if (form.validationError) {
    lines.push(`${margin}${style.error(`验证失败 · ${sanitizeTerminalText(form.validationError, false)}`)}`);
  }
  return lines.slice(0, rows).map((line) => crop(line, columns));
}

function formHelp(form: TerminalFormState): string {
  if (!form.editing) return "Tab / ↑↓ 切换  ·  Enter 编辑  ·  Space 选择  ·  Ctrl+Enter 提交";
  return form.editing.multiline
    ? "Enter 换行  ·  F2 保存  ·  Ctrl+Enter 提交  ·  Esc 放弃"
    : "Enter 保存  ·  Ctrl+Enter 提交  ·  Esc 放弃";
}
