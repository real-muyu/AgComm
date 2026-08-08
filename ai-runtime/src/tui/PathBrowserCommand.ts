export type PathBrowserCommand = "interrupt" | "quit" | "up" | "down" | "parent" | "open" | "new" | "ignore";

export function pathBrowserCommand(text: string | undefined, key: { name?: string; ctrl?: boolean }, writable: boolean): PathBrowserCommand {
  if (key.ctrl && key.name === "c") return "interrupt";
  if (key.name === "escape" || text?.toLowerCase() === "q") return "quit";
  if (key.name === "up" || key.name === "down") return key.name;
  if (key.name === "backspace") return "parent";
  if (key.name === "return") return "open";
  if (writable && text?.toLowerCase() === "n") return "new";
  return "ignore";
}
