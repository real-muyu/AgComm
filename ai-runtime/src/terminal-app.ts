import { emitKeypressEvents, type Key } from "node:readline";
import type { AiAppHandle } from "./runtime-types.ts";
import { sanitizeTerminalText, type TerminalInput, type TerminalOutput } from "./terminal-renderer.ts";
import { ConversationController } from "./tui/ConversationController.ts";
import { SessionPickerController } from "./tui/SessionPickerController.ts";

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
  private pendingKey?: { cleanup(): void; reject(error: unknown): void };
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
    if (this.pendingKey) { const pending = this.pendingKey; this.pendingKey = undefined; pending.cleanup(); pending.reject(new DOMException("Screen closed", "AbortError")); }
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
      const cleanup = () => { this.input.off("keypress", handler); signal?.removeEventListener("abort", abort); if (this.pendingKey?.reject === reject) this.pendingKey = undefined; };
      const handler = (text: string, key: Key) => { cleanup(); resolveKey({ text, key }); };
      const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      this.pendingKey = { cleanup, reject };
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

export async function runTerminalApp(app: AiAppHandle, options: TerminalAppOptions = {}) {
  const screen = new TerminalScreen(options.input ?? process.stdin, options.output ?? process.stderr);
  screen.enter();
  try {
    let first = true;
    for (;;) {
      const historyEnabled = app.interaction?.conversation?.history === true;
      const session = historyEnabled ? await new SessionPickerController().run(screen, app, options.signal) : await app.createSession();
      if (!session) return;
      const action = await new ConversationController(screen, app, session, {
        ...options,
        initialInput: first ? options.initialInput : undefined,
      }).run();
      first = false;
      await session.dispose();
      if (action === "quit" || !historyEnabled) return;
    }
  } finally { screen.leave(); }
}
