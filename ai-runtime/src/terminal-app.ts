import { emitKeypressEvents, type Key } from "node:readline";
import { readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { AiAppHandle, AiSessionHandle } from "./runtime-types.ts";
import type { KnowledgeScope } from "./app-storage.ts";
import { createTerminalRenderer, sanitizeTerminalText, type TerminalInput, type TerminalOutput } from "./terminal-renderer.ts";

const ESC = "\u001b";

export type TerminalAppOptions = {
  input?: TerminalInput;
  output?: TerminalOutput;
  initialInput?: string;
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
  formatError?: (error: unknown) => string;
  openSettings?: () => Promise<void>;
};

export class TerminalScreen {
  private entered = false;
  private previousRaw = false;
  private previouslyPaused = false;
  constructor(readonly input: TerminalInput, readonly output: TerminalOutput, private readonly alternate = true) {}

  enter() {
    if (this.entered) return;
    this.entered = true;
    this.previousRaw = Boolean(this.input.isRaw);
    this.previouslyPaused = this.input.isPaused?.() ?? false;
    emitKeypressEvents(this.input as NodeJS.ReadableStream);
    this.input.setRawMode?.(true);
    this.input.resume?.();
    if (this.alternate) this.output.write(`${ESC}[?1049h`);
    this.output.write(`${ESC}[?25l`);
  }

  leave() {
    if (!this.entered) return;
    this.input.setRawMode?.(this.previousRaw);
    if (this.previouslyPaused) this.input.pause?.();
    this.output.write(`${ESC}[0m${ESC}[?25h${this.alternate ? `${ESC}[?1049l` : ""}`);
    this.entered = false;
  }

  paint(title: string, lines: string[], footer: string) {
    this.enter();
    const rows = Math.max(12, this.output.rows ?? 32);
    const columns = Math.max(40, this.output.columns ?? 100);
    const clean = (value: string) => sanitizeTerminalText(value, false).slice(0, columns - 2);
    const body = lines.slice(-Math.max(1, rows - 6)).map((line) => `  ${clean(line)}`);
    this.output.write(`${ESC}[H${ESC}[2J\n  ${clean(title)}\n  ${"─".repeat(Math.max(1, Math.min(columns - 4, 72)))}\n${body.join("\n")}\n\n  ${clean(footer)}`);
  }

  key(signal?: AbortSignal) {
    return new Promise<{ text: string; key: Key }>((resolveKey, reject) => {
      const cleanup = () => { this.input.off("keypress", handler); signal?.removeEventListener("abort", abort); };
      const handler = (text: string, key: Key) => { cleanup(); resolveKey({ text, key }); };
      const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      this.input.on("keypress", handler);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  async prompt(title: string, label: string, signal?: AbortSignal, options: { secret?: boolean } = {}) {
    let value = "";
    for (;;) {
      this.paint(title, [label, "", `> ${options.secret ? "•".repeat(value.length) : value}`], "Enter 确认  ·  Esc 取消  ·  Ctrl+C 退出");
      const event = await this.key(signal);
      if (event.key.ctrl && event.key.name === "c") throw new DOMException("Interrupted", "AbortError");
      if (event.key.name === "escape") return undefined;
      if (event.key.name === "return") return value.trim();
      if (event.key.name === "backspace") value = value.slice(0, -1);
      else if (event.text && !event.key.ctrl && !event.key.meta) value = (value + sanitizeTerminalText(event.text, false)).slice(0, 65_536);
    }
  }
}

async function chooseSession(screen: TerminalScreen, app: AiAppHandle, signal?: AbortSignal): Promise<AiSessionHandle | undefined> {
  let selected = 0;
  for (;;) {
    const sessions = await app.listSessions();
    const items = [{ id: "", title: "新建会话", messageCount: 0 }, ...sessions];
    selected = Math.min(selected, items.length - 1);
    screen.paint(`${app.name} · 会话`, items.map((item, index) => `${index === selected ? "›" : " "} ${item.title}${item.id ? `  ·  ${item.messageCount} 条消息` : ""}`), "↑↓ 选择  ·  Enter 打开  ·  R 重命名  ·  D 删除  ·  Q 退出");
    const { text, key } = await screen.key(signal);
    if ((key.ctrl && key.name === "c") || key.name === "escape" || (text ?? "").toLowerCase() === "q") return undefined;
    if (key.name === "up") selected = (selected + items.length - 1) % items.length;
    else if (key.name === "down") selected = (selected + 1) % items.length;
    else if (key.name === "return") return selected === 0 ? app.createSession() : app.openSession(items[selected].id);
    else if ((text ?? "").toLowerCase() === "d" && selected > 0) { await app.deleteSession(items[selected].id); selected = Math.max(0, selected - 1); }
    else if ((text ?? "").toLowerCase() === "r" && selected > 0) {
      const title = await screen.prompt(app.name, "新的会话名称", signal);
      if (title) { const session = await app.openSession(items[selected].id); await session.rename(title); await session.dispose(); }
    }
  }
}

async function browseFiles(screen: TerminalScreen, signal?: AbortSignal) {
  let directory = process.cwd();
  let selected = 0;
  const chosen = new Set<string>();
  for (;;) {
    let entries;
    try { entries = (await readdir(directory, { withFileTypes: true })).filter((item) => item.isDirectory() || item.isFile()).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)); }
    catch { directory = dirname(directory); continue; }
    const items = [{ name: "..", isDirectory: () => true }, ...entries];
    selected = Math.min(selected, items.length - 1);
    screen.paint(`知识文件 · ${directory}`, items.map((item, index) => {
      const path = resolve(directory, item.name);
      const mark = item.isDirectory() ? "▸" : chosen.has(path) ? "●" : "○";
      return `${index === selected ? "›" : " "} ${mark} ${item.name}`;
    }), `↑↓ 选择  ·  Enter 进入目录  ·  Space 多选  ·  U 导入 (${chosen.size})  ·  Q 返回`);
    const { text, key } = await screen.key(signal);
    if ((key.ctrl && key.name === "c")) throw new DOMException("Interrupted", "AbortError");
    if (key.name === "escape" || (text ?? "").toLowerCase() === "q") return [];
    if (key.name === "up") selected = (selected + items.length - 1) % items.length;
    else if (key.name === "down") selected = (selected + 1) % items.length;
    else if (key.name === "backspace") { directory = dirname(directory); selected = 0; }
    else if (key.name === "return" && items[selected].isDirectory()) { directory = resolve(directory, items[selected].name); selected = 0; }
    else if ((key.name === "space" || text === " ") && !items[selected].isDirectory()) {
      const path = resolve(directory, items[selected].name);
      if (chosen.has(path)) chosen.delete(path); else chosen.add(path);
    } else if ((text ?? "").toLowerCase() === "u" && chosen.size) return [...chosen];
  }
}

async function manageKnowledge(screen: TerminalScreen, app: AiAppHandle, session: AiSessionHandle, signal?: AbortSignal) {
  const enabled = app.interaction?.knowledge?.scopes ?? ["app"];
  let scope: KnowledgeScope = enabled.includes("app") ? { type: "app" } : { type: "session", sessionId: session.id };
  let selected = 0;
  let message = "";
  for (;;) {
    const documents = await app.listKnowledge(scope);
    selected = Math.min(selected, Math.max(0, documents.length - 1));
    const lines = documents.length ? documents.map((item, index) => `${index === selected ? "›" : " "} ${item.status === "ready" ? "●" : "!"} ${item.name} · ${item.chunkCount} chunks`) : ["  暂无知识文件"];
    if (message) lines.push("", message);
    screen.paint(`${app.name} · 知识库 · ${scope.type === "app" ? "应用级" : "会话级"}`, lines, "U 上传  ·  R 重新索引  ·  D 删除  ·  Tab 切换作用域  ·  ↑↓ 选择  ·  Q 返回");
    const { text, key } = await screen.key(signal);
    if (key.ctrl && key.name === "c") throw new DOMException("Interrupted", "AbortError");
    if (key.name === "escape" || (text ?? "").toLowerCase() === "q") return;
    if (key.name === "up" && documents.length) selected = (selected + documents.length - 1) % documents.length;
    else if (key.name === "down" && documents.length) selected = (selected + 1) % documents.length;
    else if (key.name === "tab" && enabled.length > 1) scope = scope.type === "app" ? { type: "session", sessionId: session.id } : { type: "app" };
    else if ((text ?? "").toLowerCase() === "d" && documents[selected]) { await app.removeKnowledge([documents[selected].id], scope); message = "已删除"; }
    else if ((text ?? "").toLowerCase() === "r" && documents.length) {
      screen.paint(app.name, ["正在重新索引知识库…"], "请稍候");
      try { const indexed = await app.reindexKnowledge(undefined, { scope, signal }); message = `已重新索引 ${indexed.length} 个文件`; }
      catch (error) { message = `重新索引失败：${error instanceof Error ? error.message : String(error)}`; }
    }
    else if ((text ?? "").toLowerCase() === "u") {
      const paths = await browseFiles(screen, signal);
      if (!paths.length) continue;
      screen.paint(app.name, paths.map((path) => `等待索引 ${basename(path)}…`), "请稍候");
      try { const imported = await app.importKnowledge(paths, { scope, signal, onProgress(progress) {
        const detail = progress.total === undefined ? progress.phase : `${progress.phase} ${progress.completed ?? 0}/${progress.total}`;
        screen.paint(app.name, [`${progress.fileIndex + 1}/${progress.fileCount} ${progress.name}`, detail, progress.message ?? ""].filter(Boolean), "正在构建本地向量索引");
      } }); message = `已索引 ${imported.length} 个文件`; }
      catch (error) { message = `索引失败：${error instanceof Error ? error.message : String(error)}`; }
    }
  }
}

async function showAppInfo(screen: TerminalScreen, app: AiAppHandle, signal?: AbortSignal) {
  const lines = [
    `Format: v${app.info.formatVersion}`,
    `Package: ${app.packageHash}`,
    "",
    `Flow (${app.info.nodes.length})`,
    ...app.info.nodes.map((node) => `  ${node.type} · ${node.title} · ${node.id}`),
    "",
    `Bundles (${app.info.bundles.length})`,
    ...app.info.bundles.map((bundle) => `  ${bundle.kind} · ${bundle.name} · ${bundle.runtime} · ${bundle.signed ? "signed" : "unsigned"} · ${bundle.permissions.join(", ") || "no permissions"}`),
  ];
  screen.paint(`${app.name} · 应用信息`, lines, "任意键返回");
  await screen.key(signal);
}

async function conversation(screen: TerminalScreen, app: AiAppHandle, session: AiSessionHandle, options: TerminalAppOptions) {
  let pending = options.initialInput;
  for (;;) {
    const history = await session.history();
    screen.paint(`${app.name} · ${session.title}`, history.flatMap((message) => [`${message.role === "user" ? "You" : "AI"}:`, ...message.content.split("\n"), ""]), "Enter 输入  ·  I 信息  ·  K 知识库  ·  P 设置  ·  S 会话  ·  Q 退出");
    if (!pending) {
      const event = await screen.key(options.signal);
      if (event.key.ctrl && event.key.name === "c") throw new DOMException("Interrupted", "AbortError");
      if (event.key.name === "escape" || (event.text ?? "").toLowerCase() === "q") return "quit" as const;
      if ((event.text ?? "").toLowerCase() === "s") return "sessions" as const;
      if ((event.text ?? "").toLowerCase() === "i") { await showAppInfo(screen, app, options.signal); continue; }
      if ((event.text ?? "").toLowerCase() === "p" && options.openSettings) { screen.leave(); try { await options.openSettings(); } finally { screen.enter(); } continue; }
      if ((event.text ?? "").toLowerCase() === "k" && app.interaction?.knowledge) { await manageKnowledge(screen, app, session, options.signal); continue; }
      if (event.key.name !== "return") continue;
      pending = await screen.prompt(app.name, "输入消息", options.signal);
    }
    if (!pending) { pending = undefined; continue; }
    const input = pending; pending = undefined;
    screen.leave();
    try {
      await session.runTurn(input, {
        variables: options.variables, signal: options.signal,
        renderer: createTerminalRenderer({ input: screen.input, output: screen.output, formatError: options.formatError, waitOnComplete: false }),
      });
    } finally { screen.enter(); }
  }
}

export async function runTerminalApp(app: AiAppHandle, options: TerminalAppOptions = {}) {
  const screen = new TerminalScreen(options.input ?? process.stdin, options.output ?? process.stderr);
  screen.enter();
  try {
    let first = true;
    for (;;) {
      const historyEnabled = app.interaction?.conversation?.history === true;
      const session = historyEnabled ? await chooseSession(screen, app, options.signal) : await app.createSession();
      if (!session) return;
      const action = await conversation(screen, app, session, { ...options, initialInput: first ? options.initialInput : undefined });
      first = false;
      await session.dispose();
      if (action === "quit" || !historyEnabled) return;
    }
  } finally { screen.leave(); }
}
