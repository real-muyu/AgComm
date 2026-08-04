import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { AiRuntimeError } from "./errors.ts";
import type { ModelEvent } from "./model-provider.ts";
import type { AiStreamEvent } from "./runtime-types.ts";
import type {
  RuntimeInputField,
  RuntimeInputRequest,
  RuntimeRenderer,
  RuntimeRendererResult,
  RuntimeRendererStart,
} from "./renderer.ts";
import { sanitizeTerminalText } from "./terminal-renderer.ts";

const MAX_FIELD_CHARS = 65_536;
const MAX_OUTPUT_CHARS = 1_048_576;

export type LineRendererInput = NodeJS.ReadableStream;
export type LineRendererOutput = NodeJS.WritableStream;

export type LineRendererOptions = {
  input?: LineRendererInput;
  output?: LineRendererOutput;
  interactive?: boolean;
  formatError?: (error: unknown) => string;
};

function text(value: unknown, multiline = false) {
  return sanitizeTerminalText(value, multiline).slice(0, MAX_FIELD_CHARS);
}

function valueText(value: unknown) {
  if (value === undefined) return "";
  if (typeof value === "string") return text(value);
  try { return text(JSON.stringify(value)); }
  catch { return text(String(value)); }
}

function currentButtonIndex(fields: RuntimeInputField[], variables: Readonly<Record<string, unknown>>) {
  return fields.findIndex((field) => Object.hasOwn(variables, field.variable)
    && String(variables[field.variable]) === String(field.buttonValue ?? "true"));
}

function inputValues(request: RuntimeInputRequest) {
  return Object.fromEntries(request.form.fields.map((field) => [field.variable, request.variables[field.variable]]));
}

class LineRenderer implements RuntimeRenderer {
  private readonly input: LineRendererInput;
  private readonly output: LineRendererOutput;
  private readonly interactive: boolean;
  private readonly formatError: (error: unknown) => string;
  private readline?: ReadlineInterface;
  private readonly queuedLines: Array<{ value: string; tooLarge: boolean }> = [];
  private pendingLine?: {
    resolve(value: string): void;
    reject(error: unknown): void;
    cleanup(): void;
  };
  private inputEnded = false;
  private asking = false;
  private bufferedEvents = "";
  private disposed = false;

  constructor(options: LineRendererOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stderr;
    this.interactive = options.interactive ?? true;
    this.formatError = options.formatError ?? ((error) => error instanceof Error ? error.message : String(error || "运行失败"));
  }

  private write(value: string) {
    if (!this.interactive || this.disposed) return;
    this.output.write(text(value, true).slice(0, MAX_OUTPUT_CHARS));
  }

  private interface() {
    if (!this.readline) {
      this.readline = createInterface({ input: this.input, terminal: false, crlfDelay: Infinity });
      this.readline.on("line", (line) => {
        const item = { value: line.slice(0, MAX_FIELD_CHARS), tooLarge: line.length > MAX_FIELD_CHARS };
        if (this.pendingLine) {
          const pending = this.pendingLine;
          this.pendingLine = undefined;
          pending.cleanup();
          if (item.tooLarge) pending.reject(new AiRuntimeError("INPUT_VALUE_TOO_LARGE", `Input exceeds ${MAX_FIELD_CHARS} characters`));
          else pending.resolve(item.value);
        } else if (this.queuedLines.length < 256) this.queuedLines.push(item);
      });
      this.readline.once("close", () => {
        this.inputEnded = true;
        if (this.pendingLine) {
          const pending = this.pendingLine;
          this.pendingLine = undefined;
          pending.cleanup();
          pending.reject(new AiRuntimeError("INPUT_STREAM_ENDED", "Input stream ended before the form was completed"));
        }
      });
    }
    return this.readline;
  }

  private flushEvents() {
    if (!this.bufferedEvents) return;
    const pending = this.bufferedEvents;
    this.bufferedEvents = "";
    this.write(pending);
  }

  private async ask(prompt: string, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason ?? new DOMException("Interrupted", "AbortError");
    this.asking = true;
    try {
      this.interface();
      this.output.write(text(prompt));
      const queued = this.queuedLines.shift();
      if (queued?.tooLarge) throw new AiRuntimeError("INPUT_VALUE_TOO_LARGE", `Input exceeds ${MAX_FIELD_CHARS} characters`);
      if (queued) return text(queued.value);
      if (this.inputEnded) throw new AiRuntimeError("INPUT_STREAM_ENDED", "Input stream ended before the form was completed");
      const answer = await new Promise<string>((resolve, reject) => {
        const abort = () => {
          if (this.pendingLine?.reject !== reject) return;
          this.pendingLine = undefined;
          cleanup();
          reject(signal.reason ?? new DOMException("Interrupted", "AbortError"));
        };
        const cleanup = () => signal.removeEventListener("abort", abort);
        this.pendingLine = { resolve, reject, cleanup };
        signal.addEventListener("abort", abort, { once: true });
      });
      return text(answer);
    } finally {
      this.asking = false;
      this.flushEvents();
    }
  }

  async start(context: RuntimeRendererStart) {
    if (!this.interactive) return;
    this.write(`\nAI Runtime · ${text(context.projectName)}\n模型：${text(context.model)}\n`);
  }

  private describe(request: RuntimeInputRequest) {
    this.write(`\n输入节点：${text(request.node.title)}\n`);
    if (request.validationError) this.write(`上次输入无效：${text(request.validationError)}\n`);
    const ordinary = request.form.fields.filter((field) => field.component !== "button");
    ordinary.forEach((field, index) => {
      const current = Object.hasOwn(request.variables, field.variable) ? valueText(request.variables[field.variable]) : "（未设置）";
      const placeholder = field.placeholder ? `；提示：${text(field.placeholder)}` : "";
      this.write(`  ${index + 1}. ${text(field.label)} [${text(field.variable)}:${text(field.variableType)}] 当前：${current}${placeholder}\n`);
    });
    const buttons = request.form.fields.filter((field) => field.component === "button");
    if (buttons.length) {
      this.write("  按钮选项：\n");
      buttons.forEach((field, index) => this.write(`    ${index + 1}. ${text(field.label)} → ${text(field.variable)}=${text(field.buttonValue ?? "true")}\n`));
    }
  }

  private validateNonInteractive(request: RuntimeInputRequest) {
    const missing = request.form.fields
      .filter((field) => field.component !== "button" && !Object.hasOwn(request.variables, field.variable))
      .map((field) => field.variable);
    const buttons = request.form.fields.filter((field) => field.component === "button");
    if (buttons.length && currentButtonIndex(buttons, request.variables) < 0) missing.push(`button:${request.node.id}`);
    if (missing.length) {
      throw new AiRuntimeError("INPUT_VALUES_REQUIRED", `INPUT node ${request.node.id} requires values: ${missing.join(", ")}`);
    }
  }

  async requestInput(request: RuntimeInputRequest) {
    if (!this.interactive) {
      this.validateNonInteractive(request);
      return inputValues(request);
    }

    this.describe(request);
    const values = inputValues(request);
    for (const field of request.form.fields.filter((item) => item.component !== "button")) {
      const hasCurrent = Object.hasOwn(request.variables, field.variable);
      const current = hasCurrent ? valueText(values[field.variable]) : "";
      if (field.component === "checkbox") {
        const selected = values[field.variable] === true || String(values[field.variable]).toLowerCase() === "true" || values[field.variable] === 1;
        for (;;) {
          const answer = (await this.ask(`${text(field.label)} (${text(field.variable)}) [${selected ? "Y/n" : "y/N"}]: `, request.signal)).trim().toLowerCase();
          if (!answer) { values[field.variable] = selected; break; }
          if (["y", "yes", "1", "true"].includes(answer)) { values[field.variable] = true; break; }
          if (["n", "no", "0", "false"].includes(answer)) { values[field.variable] = false; break; }
          this.write("请输入 y/yes/1/true 或 n/no/0/false。\n");
        }
        continue;
      }
      const suffix = hasCurrent ? ` [${current}]` : field.placeholder ? ` [${text(field.placeholder)}]` : "";
      const answer = await this.ask(`${text(field.label)} (${text(field.variable)}:${text(field.variableType)})${suffix}: `, request.signal);
      values[field.variable] = answer === "" && hasCurrent ? values[field.variable] : answer;
    }

    const buttons = request.form.fields.filter((field) => field.component === "button");
    if (buttons.length) {
      const selected = currentButtonIndex(buttons, values);
      for (;;) {
        const suffix = selected >= 0 ? ` [${selected + 1}]` : "";
        const answer = (await this.ask(`请选择按钮 1-${buttons.length}${suffix}: `, request.signal)).trim();
        if (!answer && selected >= 0) break;
        if (/^\d+$/.test(answer)) {
          const index = Number(answer) - 1;
          if (index >= 0 && index < buttons.length) {
            const field = buttons[index];
            values[field.variable] = field.buttonValue ?? "true";
            break;
          }
        }
        this.write(`请输入 1-${buttons.length} 的编号。\n`);
      }
    }
    return values;
  }

  onModelEvent(event: ModelEvent) {
    if (!this.interactive) return;
    const output = event.type === "tool-call-delta" && event.name ? `\n调用工具：${text(event.name)}\n` : "";
    if (!output) return;
    if (this.asking) this.bufferedEvents = (this.bufferedEvents + output).slice(-MAX_OUTPUT_CHARS);
    else this.write(output);
  }

  onStreamEvent(event: AiStreamEvent) {
    if (!this.interactive || event.type !== "output-delta") return;
    const output = text(event.text, true);
    if (this.asking) this.bufferedEvents = (this.bufferedEvents + output).slice(-MAX_OUTPUT_CHARS);
    else this.write(output);
  }

  async complete(result: RuntimeRendererResult) {
    if (!this.interactive) return;
    this.flushEvents();
    this.write(`\n\n运行完成（${result.elapsedMs}ms）\n输出：${valueText(result.output)}\n`);
  }

  async fail(error: unknown) {
    if (!this.interactive) return;
    this.flushEvents();
    this.write(`\n运行失败：${text(this.formatError(error))}\n`);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pendingLine) {
      const pending = this.pendingLine;
      this.pendingLine = undefined;
      pending.cleanup();
      pending.reject(new DOMException("Renderer disposed", "AbortError"));
    }
    this.readline?.close();
    this.readline = undefined;
    this.queuedLines.length = 0;
    this.bufferedEvents = "";
  }
}

export function createLineRenderer(options: LineRendererOptions = {}): RuntimeRenderer {
  return new LineRenderer(options);
}
