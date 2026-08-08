import { basename, resolve } from "node:path";
import { TerminalScreen } from "../terminal-app.ts";
import { PathBrowserState } from "./PathBrowserState.ts";
import { pathBrowserCommand } from "./PathBrowserCommand.ts";

async function newPath(screen: TerminalScreen, state: PathBrowserState, title: string, signal?: AbortSignal) {
  const name = await screen.prompt(title, "文件名", signal);
  if (name && basename(name) === name && name !== "." && name !== "..") return resolve(state.directory, name);
  return undefined;
}

type BrowserAction = { done?: boolean; path?: string; message?: string };
async function executePathCommand(command: ReturnType<typeof pathBrowserCommand>, screen: TerminalScreen, state: PathBrowserState, title: string, signal?: AbortSignal): Promise<BrowserAction> {
  const handlers: Record<ReturnType<typeof pathBrowserCommand>, () => Promise<BrowserAction>> = {
    interrupt: async () => { throw new DOMException("Interrupted", "AbortError"); },
    quit: async () => ({ done: true }),
    up: async () => { state.move(-1); return {}; },
    down: async () => { state.move(1); return {}; },
    parent: async () => { state.parent(); return {}; },
    open: async () => { const path = state.open(); return path ? { done: true, path } : {}; },
    new: async () => { const path = await newPath(screen, state, title, signal); return path ? { done: true, path } : { message: "文件名无效" }; },
    ignore: async () => ({}),
  };
  return handlers[command]();
}

async function refreshPathBrowser(state: PathBrowserState) {
  try { await state.refresh(); return ""; }
  catch (error) { state.parent(); return error instanceof Error ? error.message : "无法读取目录"; }
}

function paintPathBrowser(screen: TerminalScreen, state: PathBrowserState, options: { title: string; mode?: "read" | "write" }, message: string) {
  const lines = state.rows();
  if (message) lines.push("", message);
  screen.paint(`${options.title} · ${state.directory}`, lines, `↑↓ 选择  ·  Enter ${options.mode === "write" ? "选择/进入" : "打开/进入"}${options.mode === "write" ? "  ·  N 新文件" : ""}  ·  Q 返回`);
}

export async function selectTerminalPath(screen: TerminalScreen, options: { title: string; extensions?: readonly string[]; mode?: "read" | "write"; initialDirectory?: string }, signal?: AbortSignal) {
  const state = new PathBrowserState(options.initialDirectory ?? process.cwd(), new Set((options.extensions ?? []).map((item) => item.toLowerCase()))); let message = "";
  for (;;) {
    message = await refreshPathBrowser(state) || message;
    paintPathBrowser(screen, state, options, message);
    const { text, key } = await screen.key(signal);
    const action = await executePathCommand(pathBrowserCommand(text, key, options.mode === "write"), screen, state, options.title, signal);
    if (action.message) message = action.message;
    if (action.done) return action.path;
  }
}
