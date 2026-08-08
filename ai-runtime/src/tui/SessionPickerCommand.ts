export type SessionPickerCommand = "quit" | "up" | "down" | "open" | "rename" | "delete" | "ignore";

export function sessionPickerCommand(text: string | undefined, key: { name?: string; ctrl?: boolean }): SessionPickerCommand {
  if ((key.ctrl && key.name === "c") || key.name === "escape") return "quit";
  if (key.name === "up" || key.name === "down") return key.name;
  if (key.name === "return") return "open";
  const value = (text ?? "").toLowerCase();
  if (value === "q") return "quit";
  if (value === "r") return "rename";
  if (value === "d") return "delete";
  return "ignore";
}
