import type { Key } from "node:readline";
import type { RuntimeInputField } from "../../renderer.ts";
import { sanitizeTerminalText } from "./TerminalText.ts";

export function editableTerminalValue(field: RuntimeInputField, value: unknown): string {
  const type = field.variableType.toLowerCase();
  if (["array", "object"].includes(type) && value !== null && typeof value === "object") return sanitizeTerminalText(value);
  return sanitizeTerminalText(value ?? "");
}

export function isTerminalSubmitKey(text: string, key: Key): boolean {
  return key.name === "f10"
    || (key.ctrl && (key.name === "return" || key.name === "enter"))
    || key.sequence === "\n"
    || text === "\n";
}
