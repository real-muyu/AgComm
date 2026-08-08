import type { ModelEvent } from "./runtime/contracts/ModelPort.ts";
import type { AiStreamEvent, RuntimeEvent } from "./runtime-types.ts";
import type {
  RuntimeInputRequest,
  RuntimeRenderer,
  RuntimeRendererResult,
  RuntimeRendererStart,
} from "./renderer.ts";
import { TerminalFormState, handleTerminalFormKey } from "./tui/renderer/TerminalFormController.ts";
import { renderTerminalForm } from "./tui/renderer/TerminalFormView.ts";
import { TerminalSession, type TerminalSessionInput, type TerminalSessionOutput } from "./tui/renderer/TerminalSession.ts";
import { sanitizeRuntimeUpdate, terminalRuntimeEvent } from "./tui/renderer/TerminalRuntimeEvent.ts";
import {
  cropTerminalText as crop,
  formatElapsed,
  sanitizeTerminalText,
  wrapTerminalText as wrap,
} from "./tui/renderer/TerminalText.ts";

const ESC = "\u001b";
const MAX_OUTPUT_CHARS = 1_048_576;
const MAX_CONTENT_WIDTH = 96;
const BLACK_BACKGROUND = "48;2;0;0;0";
const ACCENT_TRUE_COLOR = "38;2;32;178;170";
const ACCENT_256_COLOR = "38;5;37";
const MUTED_COLOR = "38;5;245";
const ERROR_COLOR = "38;5;203";

export type TerminalInput = TerminalSessionInput;
export type TerminalOutput = TerminalSessionOutput & { columns?: number; rows?: number };

export type TerminalRendererOptions = {
  input?: TerminalInput;
  output?: TerminalOutput;
  color?: boolean;
  formatError?: (error: unknown) => string;
  waitOnComplete?: boolean;
};

type RendererState = "running" | "waiting" | "completed" | "failed";

function errorText(error: unknown) {
  return sanitizeTerminalText(error instanceof Error ? error.message : String(error || "运行失败"));
}

export { sanitizeTerminalText } from "./tui/renderer/TerminalText.ts";

class TerminalRenderer implements RuntimeRenderer {
  private readonly input: TerminalInput;
  private readonly output: TerminalOutput;
  private readonly color: boolean;
  private readonly accentCode: string;
  private readonly formatError: (error: unknown) => string;
  private readonly waitOnComplete: boolean;
  private readonly session: TerminalSession;
  private projectName = "AgComm";
  private model = "";
  private phase = "准备运行";
  private state: RendererState = "running";
  private streamed = "";
  private finalOutput = "";
  private activity: string[] = [];
  private cancel?: (reason?: unknown) => void;
  private repaint: () => void = () => this.paintOutput();
  private startedAt = Date.now();
  private elapsedMs?: number;
  private clock?: NodeJS.Timeout;
  private pendingInputReject?: (error: unknown) => void;
  private pendingExitResolve?: () => void;

  constructor(options: TerminalRendererOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stderr;
    this.color = options.color ?? !Object.hasOwn(process.env, "NO_COLOR");
    const trueColor = /truecolor|24bit/i.test(process.env.COLORTERM ?? "")
      || Boolean(process.env.TERM_PROGRAM)
      || process.platform === "win32";
    this.accentCode = trueColor ? ACCENT_TRUE_COLOR : ACCENT_256_COLOR;
    this.formatError = options.formatError ?? errorText;
    this.waitOnComplete = options.waitOnComplete ?? true;
    this.session = new TerminalSession(this.input, this.output, this.color, () => this.repaint());
  }

  private style(code: string | number, value: string) {
    return this.color ? `${ESC}[${code}m${value}${ESC}[0m${ESC}[${BLACK_BACKGROUND}m` : value;
  }

  private accent(value: string) { return this.style(this.accentCode, value); }
  private muted(value: string) { return this.style(MUTED_COLOR, value); }
  private bold(value: string) { return this.style(1, value); }
  private error(value: string) { return this.style(ERROR_COLOR, value); }

  private enter() { this.session.enter(); }

  private dimensions() {
    return { columns: Math.max(40, this.output.columns ?? 100), rows: Math.max(12, this.output.rows ?? 32) };
  }

  private contentLayout() {
    const { columns } = this.dimensions();
    const width = Math.max(36, Math.min(MAX_CONTENT_WIDTH, columns - 4));
    return { width, margin: " ".repeat(Math.max(1, Math.floor((columns - width) / 2))) };
  }

  private frame(lines: string[]) {
    this.enter();
    const { columns, rows } = this.dimensions();
    const visible = lines.slice(0, rows).map((line) => crop(line, columns));
    this.output.write(`${this.color ? `${ESC}[${BLACK_BACKGROUND}m` : ""}${ESC}[H${ESC}[2J${visible.join("\n")}`);
  }

  private statusMark() {
    if (this.state === "completed") return this.accent("●");
    if (this.state === "failed") return this.error("●");
    if (this.state === "waiting") return this.accent("◇");
    return this.accent("◆");
  }

  private header(detail = "") {
    const { width, margin } = this.contentLayout();
    const elapsed = formatElapsed(this.elapsedMs ?? Math.max(0, Date.now() - this.startedAt));
    const title = `${this.statusMark()}  ${this.bold(sanitizeTerminalText(this.projectName, false))}`;
    const status = [sanitizeTerminalText(detail || this.phase, false), this.model && sanitizeTerminalText(this.model, false), elapsed].filter(Boolean).join("  ·  ");
    return [`${margin}${crop(title, width)}`, `${margin}${this.muted(crop(status, width))}`];
  }

  private bind(handler: Parameters<TerminalSession["bind"]>[0], signal?: AbortSignal) { return this.session.bind(handler, signal); }
  private unbind() { this.session.unbind(); }

  async start(context: RuntimeRendererStart) {
    this.stopClock();
    this.projectName = context.projectName;
    this.model = context.model;
    this.phase = "正在执行";
    this.state = "running";
    this.cancel = context.cancel;
    this.startedAt = Date.now();
    this.elapsedMs = undefined;
    this.enter();
    this.listenForCancel();
    this.clock = setInterval(() => this.repaint(), 250);
    this.clock.unref?.();
    this.paintOutput();
  }

  private stopClock() {
    if (this.clock) clearInterval(this.clock);
    this.clock = undefined;
  }

  private listenForCancel() {
    if (!this.cancel) return;
    this.bind((_text, key) => {
      if (key.ctrl && key.name === "c") this.cancel?.(new DOMException("Interrupted", "AbortError"));
    });
  }

  onModelEvent(event: ModelEvent) {
    if (event.type === "token") this.phase = "正在生成回复";
    else this.phase = `正在调用 ${event.name ? sanitizeTerminalText(event.name, false) : "工具"}`;
    this.state = "running";
    this.paintOutput();
  }

  onStreamEvent(event: AiStreamEvent) {
    if (event.type === "output-delta") {
      this.streamed = (this.streamed + sanitizeTerminalText(event.text)).slice(-MAX_OUTPUT_CHARS);
      this.phase = "正在生成回复";
      this.state = "running";
      this.paintOutput();
    }
  }

  onRuntimeEvent(event: RuntimeEvent) {
    const update = sanitizeRuntimeUpdate(terminalRuntimeEvent(event));
    if (update.phase) this.phase = update.phase;
    if (update.activity) this.activity.push(update.activity);
    this.activity = this.activity.slice(-5);
    this.paintOutput();
  }

  private paintOutput() {
    if (!this.session.active) return;
    const { rows } = this.dimensions();
    const { width, margin } = this.contentLayout();
    const content = this.finalOutput || this.streamed || (this.state === "completed" ? "（无输出）" : "请稍候…");
    const activity = this.activity.slice(-Math.max(0, Math.min(3, rows - 12)));
    const available = Math.max(3, rows - 9 - activity.length);
    const visibleTail = content.slice(-Math.max(1_024, width * available * 4));
    const body = wrap(visibleTail, width - 2);
    const final = this.state === "completed" || this.state === "failed";
    const label = this.state === "failed" ? this.error("Error") : this.accent("Response");
    const lines = [
      "",
      ...this.header(),
      "",
      `${margin}${label}`,
      ...body.slice(-available).map((line) => `${margin}  ${line}`),
      ...(activity.length ? ["", `${margin}${this.muted("Activity")}`, ...activity.map((line) => `${margin}  ${this.muted(crop(line, width - 2))}`)] : []),
      "",
      `${margin}${this.muted(final ? "Enter / Esc / q  退出" : "Ctrl+C  取消")}`,
    ];
    this.repaint = () => this.paintOutput();
    this.frame(lines);
  }

  async requestInput(request: RuntimeInputRequest) {
    this.phase = `等待输入 · ${request.node.title}`;
    this.state = "waiting";
    const form = new TerminalFormState(request.form.fields, request.variables, request.validationError);
    const draw = () => {
      const { columns, rows } = this.dimensions(); const { width, margin } = this.contentLayout();
      const lines = renderTerminalForm(request, form, { columns, rows, width, margin }, { accent: (value) => this.accent(value), bold: (value) => this.bold(value), muted: (value) => this.muted(value), error: (value) => this.error(value), header: (detail) => this.header(detail) });
      this.repaint = draw; this.frame(lines);
    };
    draw();
    try { return await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingInputReject = reject;
      const cleanupAbort = this.bind((text, key) => {
        if (request.signal.aborted) { this.unbind(); cleanupAbort(); reject(request.signal.reason ?? new DOMException("Interrupted", "AbortError")); return; }
        const action = handleTerminalFormKey(form, text, key);
        if (action === "abort") { this.unbind(); cleanupAbort(); reject(new DOMException("Interrupted", "AbortError")); return; }
        if (action === "submit") { this.unbind(); cleanupAbort(); this.state = "running"; this.phase = "正在执行"; this.listenForCancel(); resolve(form.values); return; }
        if (action === "redraw") draw();
      }, request.signal);
    }); } finally { this.pendingInputReject = undefined; }
  }

  private async waitForExit() {
    if (!this.input.isTTY) return;
    await new Promise<void>((resolve) => {
      this.pendingExitResolve = resolve;
      this.bind((text, key) => {
        if (key.name === "return" || key.name === "escape" || text.toLowerCase() === "q" || (key.ctrl && key.name === "c")) { this.unbind(); this.pendingExitResolve = undefined; resolve(); }
      });
    });
  }

  async complete(result: RuntimeRendererResult) {
    this.stopClock();
    this.state = "completed";
    this.phase = result.status === "paused" ? "已暂停" : "已完成";
    this.elapsedMs = result.elapsedMs;
    this.finalOutput = sanitizeTerminalText(result.output);
    this.paintOutput();
    if (this.waitOnComplete) await this.waitForExit();
  }

  async fail(error: unknown) {
    this.stopClock();
    this.state = "failed";
    this.phase = "运行失败";
    this.elapsedMs = Math.max(0, Date.now() - this.startedAt);
    this.finalOutput = sanitizeTerminalText(this.formatError(error));
    this.paintOutput();
    const name = error instanceof Error ? error.name : "";
    if (this.waitOnComplete && name !== "AbortError" && !/cancel|abort|取消|interrupted/i.test(this.finalOutput)) await this.waitForExit();
  }

  async dispose() {
    this.stopClock();
    this.session.dispose();
    this.pendingInputReject?.(new DOMException("Renderer disposed", "AbortError"));
    this.pendingInputReject = undefined;
    this.pendingExitResolve?.();
    this.pendingExitResolve = undefined;
  }
}

export function createTerminalRenderer(options: TerminalRendererOptions = {}): RuntimeRenderer {
  return new TerminalRenderer(options);
}
