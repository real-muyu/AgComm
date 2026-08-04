import { emitKeypressEvents } from "node:readline";
import type { Key } from "node:readline";
import type { ModelEvent } from "./model-provider.ts";
import type { AiStreamEvent, RuntimeEvent } from "./runtime-types.ts";
import type {
  RuntimeInputField,
  RuntimeInputRequest,
  RuntimeRenderer,
  RuntimeRendererResult,
  RuntimeRendererStart,
} from "./renderer.ts";

const ESC = "\u001b";
const MAX_FIELD_CHARS = 65_536;
const MAX_OUTPUT_CHARS = 1_048_576;
const MAX_CONTENT_WIDTH = 96;
const BLACK_BACKGROUND = "48;2;0;0;0";
const ACCENT_TRUE_COLOR = "38;2;32;178;170";
const ACCENT_256_COLOR = "38;5;37";
const MUTED_COLOR = "38;5;245";
const ERROR_COLOR = "38;5;203";
const ANSI_SGR = /\u001b\[[0-9;]*m/g;

export type TerminalInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(mode: boolean): void;
};

export type TerminalOutput = NodeJS.WritableStream & {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
};

export type TerminalRendererOptions = {
  input?: TerminalInput;
  output?: TerminalOutput;
  color?: boolean;
  formatError?: (error: unknown) => string;
  waitOnComplete?: boolean;
};

type KeyHandler = (text: string, key: Key) => void;
type RendererState = "running" | "waiting" | "completed" | "failed";

export function sanitizeTerminalText(value: unknown, multiline = true) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  return text
    .replace(/\u001b(?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(multiline ? /\r\n?/g : /[\r\n]+/g, multiline ? "\n" : " ");
}

function widthOf(value: string) {
  let width = 0;
  for (const char of value.replace(ANSI_SGR, "")) {
    width += /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1;
  }
  return width;
}

function crop(value: string, maximum: number): string {
  if (maximum <= 0) return "";
  let output = "";
  let visible = 0;
  let index = 0;
  while (index < value.length) {
    if (value[index] === ESC) {
      const match = /^\u001b\[[0-9;]*m/.exec(value.slice(index));
      if (match) { output += match[0]; index += match[0].length; continue; }
    }
    const point = value.codePointAt(index);
    if (point === undefined) break;
    const char = String.fromCodePoint(point);
    const charWidth = widthOf(char);
    if (visible + charWidth > maximum) {
      if (maximum > 1) output += `${ESC}[0m…`;
      else output = "…";
      return output;
    }
    output += char;
    visible += charWidth;
    index += char.length;
  }
  return output;
}

function pad(value: string, length: number) {
  const text = crop(value, length);
  return text + " ".repeat(Math.max(0, length - widthOf(text)));
}

function wrap(value: string, width: number) {
  const lines: string[] = [];
  for (const source of value.split("\n")) {
    if (!source) { lines.push(""); continue; }
    let line = "";
    for (const char of source) {
      if (widthOf(line + char) > width) { lines.push(line); line = char; }
      else line += char;
    }
    lines.push(line);
  }
  return lines;
}

function editableValue(field: RuntimeInputField, value: unknown) {
  const type = field.variableType.toLowerCase();
  if (["array", "object"].includes(type) && value !== null && typeof value === "object") return sanitizeTerminalText(value);
  return sanitizeTerminalText(value ?? "");
}

function spanFor(field: RuntimeInputField, layout: RuntimeInputRequest["form"]["layout"], narrow: boolean) {
  if (narrow || layout === "single") return 6;
  if (layout === "two-column") return field.size === "large" ? 6 : 3;
  return field.size === "large" ? 6 : field.size === "medium" ? 4 : 2;
}

function gridRows(fields: RuntimeInputField[], layout: RuntimeInputRequest["form"]["layout"], narrow: boolean) {
  const rows: Array<Array<{ field: RuntimeInputField; index: number; span: number }>> = [];
  let row: Array<{ field: RuntimeInputField; index: number; span: number }> = [];
  let used = 0;
  fields.forEach((field, index) => {
    const span = spanFor(field, layout, narrow);
    if (used && used + span > 6) { rows.push(row); row = []; used = 0; }
    row.push({ field, index, span }); used += span;
    if (used === 6) { rows.push(row); row = []; used = 0; }
  });
  if (row.length) rows.push(row);
  return rows;
}

function errorText(error: unknown) {
  return sanitizeTerminalText(error instanceof Error ? error.message : String(error || "运行失败"));
}

function formatElapsed(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function isSubmitKey(text: string, key: Key) {
  return key.name === "f10"
    || (key.ctrl && (key.name === "return" || key.name === "enter"))
    || key.sequence === "\n"
    || text === "\n";
}

class TerminalRenderer implements RuntimeRenderer {
  private readonly input: TerminalInput;
  private readonly output: TerminalOutput;
  private readonly color: boolean;
  private readonly accentCode: string;
  private readonly formatError: (error: unknown) => string;
  private readonly waitOnComplete: boolean;
  private entered = false;
  private previousRaw = false;
  private previouslyPaused = false;
  private previousDataListeners: Array<(...args: any[]) => void> = [];
  private handler?: KeyHandler;
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
  }

  private style(code: string | number, value: string) {
    return this.color ? `${ESC}[${code}m${value}${ESC}[0m${ESC}[${BLACK_BACKGROUND}m` : value;
  }

  private accent(value: string) { return this.style(this.accentCode, value); }
  private muted(value: string) { return this.style(MUTED_COLOR, value); }
  private bold(value: string) { return this.style(1, value); }
  private error(value: string) { return this.style(ERROR_COLOR, value); }

  private enter() {
    if (this.entered) return;
    this.entered = true;
    this.previousRaw = Boolean(this.input.isRaw);
    this.previouslyPaused = this.input.isPaused?.() ?? false;
    this.previousDataListeners = this.input.listeners("data") as Array<(...args: any[]) => void>;
    emitKeypressEvents(this.input as NodeJS.ReadableStream);
    this.input.setRawMode?.(true);
    this.input.resume?.();
    this.output.write(`${ESC}[?1049h${this.color ? `${ESC}[${BLACK_BACKGROUND}m` : ""}${ESC}[?25l`);
    this.output.on?.("resize", this.resize);
  }

  private readonly resize = () => this.repaint();

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

  private bind(handler: KeyHandler, signal?: AbortSignal) {
    this.unbind();
    this.handler = handler;
    this.input.on("keypress", handler);
    if (signal) {
      const abort = () => handler("", { name: "escape", ctrl: true } as Key);
      signal.addEventListener("abort", abort, { once: true });
      return () => signal.removeEventListener("abort", abort);
    }
    return () => undefined;
  }

  private unbind() {
    if (this.handler) this.input.off("keypress", this.handler);
    this.handler = undefined;
  }

  async start(context: RuntimeRendererStart) {
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
    if (event.type === "flow") {
      const flow = event.event;
      if (flow.type === "node:start") this.phase = `正在执行节点 ${flow.nodeId}`;
      else if (flow.type === "node:retry") this.phase = `正在重试节点 ${flow.nodeId}`;
      else if (flow.type === "flow:pause") this.phase = `流程已暂停 · ${flow.nodeId}`;
      else if (flow.type === "flow:complete") this.phase = "流程已完成";
      if (flow.type.startsWith("node:")) this.activity.push(`${flow.type.replace("node:", "")} · ${"nodeId" in flow ? flow.nodeId : ""}`);
    } else if (event.type === "tool") {
      this.activity.push(`tool · ${event.trace.skillName} · ${event.trace.kind}`);
    } else if (event.type === "hook") {
      this.activity.push(`hook · ${event.hookId}.${event.stage} · ${event.status}`);
    } else if (event.type === "flow-hook") {
      this.activity.push(`flow-hook · ${event.hookId}.${event.stage} · ${event.nodeId} · ${event.status}`);
    } else {
      this.activity.push(`log · ${event.log.pluginId} · ${event.log.level} · ${event.log.message}`);
    }
    this.activity = this.activity.slice(-5);
    this.paintOutput();
  }

  private paintOutput() {
    if (!this.entered) return;
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
    const values: Record<string, unknown> = Object.fromEntries(request.form.fields.map((field) => [field.variable, request.variables[field.variable]]));
    let focus = 0;
    let editing: { index: number; buffer: string; cursor: number; multiline: boolean } | undefined;
    let localMessage = request.validationError ?? "";
    let viewportStart = 0;

    const valueLine = (field: RuntimeInputField, value: unknown, selected: boolean) => {
      if (field.component === "checkbox") {
        const checked = value === true || value === "true";
        return checked ? `${selected ? "●" : "●"}  已选择` : "○  未选择";
      }
      if (field.component === "button") {
        const buttonValue = sanitizeTerminalText(field.buttonValue ?? "true", false);
        const active = String(value) === (field.buttonValue ?? "true");
        return `${active ? "✓" : "→"}  ${buttonValue}`;
      }
      const text = editing?.index === focus && selected
        ? sanitizeTerminalText(editing.buffer, false)
        : sanitizeTerminalText(value ?? "", false);
      if (text) return text;
      return sanitizeTerminalText(field.placeholder ?? "输入内容", false);
    };

    const draw = () => {
      const { columns, rows } = this.dimensions();
      const { width, margin } = this.contentLayout();
      const narrow = columns < 72;
      const bodyLines: string[] = [];
      const ranges = new Map<number, { start: number; end: number }>();

      for (const row of gridRows(request.form.fields, request.form.layout, narrow)) {
        const gap = row.length - 1;
        const usable = Math.max(18, width - gap * 2);
        const cellWidths = row.map(({ span }) => Math.max(8, Math.floor(usable * span / 6)));
        const rendered = row.map(({ field, index }, rowIndex) => {
          const selected = focus === index;
          const cellWidth = cellWidths[rowIndex];
          const marker = selected ? "│" : " ";
          const label = `${marker} ${sanitizeTerminalText(field.label, false)}`;
          const meta = `  ${sanitizeTerminalText(field.variable, false)} · ${sanitizeTerminalText(field.variableType, false)}`;
          const value = `  ${valueLine(field, values[field.variable], selected)}`;
          return [
            selected ? this.accent(pad(label, cellWidth)) : this.bold(pad(label, cellWidth)),
            this.muted(pad(meta, cellWidth)),
            selected ? this.accent(pad(value, cellWidth)) : pad(value, cellWidth),
          ];
        });
        const start = bodyLines.length;
        for (let line = 0; line < 3; line++) bodyLines.push(rendered.map((cell) => cell[line]).join("  "));
        bodyLines.push("");
        for (const { index } of row) ranges.set(index, { start, end: bodyLines.length - 1 });
      }

      const submitIndex = request.form.fields.length;
      const submitStart = bodyLines.length;
      const submitSelected = focus === submitIndex;
      bodyLines.push(submitSelected ? this.accent("│ Continue  写入变量并继续") : "  Continue  写入变量并继续");
      ranges.set(submitIndex, { start: submitStart, end: submitStart });

      const footerLines = editing ? 3 : localMessage ? 3 : 2;
      const available = Math.max(2, rows - 5 - footerLines);
      const focused = ranges.get(focus) ?? { start: 0, end: 0 };
      if (focused.start < viewportStart) viewportStart = focused.start;
      if (focused.end >= viewportStart + available) viewportStart = focused.end - available + 1;
      viewportStart = Math.max(0, Math.min(viewportStart, Math.max(0, bodyLines.length - available)));

      const lines = ["", ...this.header(`等待输入 · ${request.node.title}`), ""];
      if (viewportStart > 0) lines.push(`${margin}${this.muted("↑ 更多字段")}`);
      const bodyAvailable = available - (viewportStart > 0 ? 1 : 0) - (viewportStart + available < bodyLines.length ? 1 : 0);
      lines.push(...bodyLines.slice(viewportStart, viewportStart + Math.max(1, bodyAvailable)).map((line) => `${margin}${line}`));
      if (viewportStart + Math.max(1, bodyAvailable) < bodyLines.length) lines.push(`${margin}${this.muted("↓ 更多字段")}`);
      lines.push("");
      if (editing) {
        lines.push(`${margin}${this.muted(editing.multiline ? "Enter 换行  ·  F2 保存  ·  Ctrl+Enter 提交  ·  Esc 放弃" : "Enter 保存  ·  Ctrl+Enter 提交  ·  Esc 放弃")}`);
      } else {
        lines.push(`${margin}${this.muted("Tab / ↑↓ 切换  ·  Enter 编辑  ·  Space 选择  ·  Ctrl+Enter 提交")}`);
      }
      if (localMessage) lines.push(`${margin}${this.error(`验证失败 · ${sanitizeTerminalText(localMessage, false)}`)}`);
      this.repaint = draw;
      this.frame(lines.slice(0, rows));
    };

    draw();
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const cleanupAbort = this.bind((text, key) => {
        if (request.signal.aborted || (key.ctrl && (key.name === "c" || key.name === "escape"))) {
          this.unbind(); cleanupAbort(); reject(request.signal.reason ?? new DOMException("Interrupted", "AbortError")); return;
        }

        const submit = () => {
          if (editing) {
            values[request.form.fields[editing.index].variable] = editing.buffer;
            editing = undefined;
          }
          this.unbind(); cleanupAbort(); this.state = "running"; this.phase = "正在执行"; this.listenForCancel(); resolve(values);
        };

        if (isSubmitKey(text, key)) { submit(); return; }

        if (editing) {
          const commit = key.name === "f2" || (!editing.multiline && key.name === "return");
          if (commit) {
            values[request.form.fields[editing.index].variable] = editing.buffer;
            editing = undefined; localMessage = ""; draw(); return;
          }
          if (key.name === "escape") { editing = undefined; draw(); return; }
          if (editing.multiline && key.name === "return") {
            editing.buffer = `${editing.buffer.slice(0, editing.cursor)}\n${editing.buffer.slice(editing.cursor)}`.slice(0, MAX_FIELD_CHARS);
            editing.cursor++; draw(); return;
          }
          if (key.name === "backspace") {
            if (editing.cursor > 0) { editing.buffer = editing.buffer.slice(0, editing.cursor - 1) + editing.buffer.slice(editing.cursor); editing.cursor--; }
            draw(); return;
          }
          if (key.name === "delete") { editing.buffer = editing.buffer.slice(0, editing.cursor) + editing.buffer.slice(editing.cursor + 1); draw(); return; }
          if (key.name === "left") { editing.cursor = Math.max(0, editing.cursor - 1); draw(); return; }
          if (key.name === "right") { editing.cursor = Math.min(editing.buffer.length, editing.cursor + 1); draw(); return; }
          if (key.name === "home") { editing.cursor = 0; draw(); return; }
          if (key.name === "end") { editing.cursor = editing.buffer.length; draw(); return; }
          if (text && !key.ctrl && !key.meta) {
            const inserted = sanitizeTerminalText(text, editing.multiline).slice(0, MAX_FIELD_CHARS - editing.buffer.length);
            editing.buffer = editing.buffer.slice(0, editing.cursor) + inserted + editing.buffer.slice(editing.cursor);
            editing.cursor += inserted.length; draw();
          }
          return;
        }

        const count = request.form.fields.length + 1;
        if (key.name === "tab" || key.name === "right" || key.name === "down") { focus = (focus + (key.shift ? count - 1 : 1)) % count; draw(); return; }
        if (key.name === "left" || key.name === "up") { focus = (focus + count - 1) % count; draw(); return; }
        if (focus === request.form.fields.length && key.name === "return") { submit(); return; }
        const field = request.form.fields[focus];
        if (!field) return;
        if (field.component === "checkbox" && (key.name === "space" || key.name === "return")) {
          values[field.variable] = !(values[field.variable] === true || values[field.variable] === "true"); localMessage = ""; draw(); return;
        }
        if (field.component === "button" && (key.name === "space" || key.name === "return")) {
          values[field.variable] = field.buttonValue ?? "true"; localMessage = ""; draw(); return;
        }
        if (field.component === "input" && key.name === "return") {
          const buffer = editableValue(field, values[field.variable]);
          editing = { index: focus, buffer, cursor: buffer.length, multiline: ["markdown", "array", "object"].includes(field.variableType.toLowerCase()) };
          draw();
        }
      }, request.signal);
    });
  }

  private async waitForExit() {
    if (!this.input.isTTY) return;
    await new Promise<void>((resolve) => {
      this.bind((text, key) => {
        if (key.name === "return" || key.name === "escape" || text.toLowerCase() === "q" || (key.ctrl && key.name === "c")) { this.unbind(); resolve(); }
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
    this.unbind();
    if (!this.entered) return;
    this.output.off?.("resize", this.resize);
    this.input.setRawMode?.(this.previousRaw);
    if (this.previouslyPaused || !this.previousDataListeners.length) this.input.pause?.();
    this.output.write(`${this.color ? `${ESC}[0m` : ""}${ESC}[?25h${ESC}[?1049l`);
    this.entered = false;
  }
}

export function createTerminalRenderer(options: TerminalRendererOptions = {}): RuntimeRenderer {
  return new TerminalRenderer(options);
}
