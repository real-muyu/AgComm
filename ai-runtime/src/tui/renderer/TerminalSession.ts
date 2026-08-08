import { emitKeypressEvents } from "node:readline";
import type { Key } from "node:readline";

const ESC = "\u001b";

export type TerminalSessionInput = NodeJS.ReadableStream & { isTTY?: boolean; isRaw?: boolean; setRawMode?(mode: boolean): void };
export type TerminalSessionOutput = NodeJS.WritableStream & { isTTY?: boolean; on?(event: string, listener: (...args: any[]) => void): unknown; off?(event: string, listener: (...args: any[]) => void): unknown };
type KeyHandler = (text: string, key: Key) => void;

export class TerminalSession {
  private entered = false;
  private previousRaw = false;
  private previouslyPaused = false;
  private previousDataListeners: Array<(...args: any[]) => void> = [];
  private handler?: KeyHandler;
  private abortCleanup?: () => void;
  constructor(private readonly input: TerminalSessionInput, private readonly output: TerminalSessionOutput, private readonly color: boolean, private readonly onResize: () => void) {}
  enter() {
    if (this.entered) return;
    this.entered = true; this.previousRaw = Boolean(this.input.isRaw); this.previouslyPaused = this.input.isPaused?.() ?? false;
    this.previousDataListeners = this.input.listeners("data") as Array<(...args: any[]) => void>;
    emitKeypressEvents(this.input); this.input.setRawMode?.(true); this.input.resume?.();
    this.output.write(`${ESC}[?1049h${this.color ? `${ESC}[48;2;0;0;0m` : ""}${ESC}[?25l`);
    this.output.on?.("resize", this.onResize);
  }
  bind(handler: KeyHandler, signal?: AbortSignal) {
    this.unbind(); this.handler = handler; this.input.on("keypress", handler);
    if (!signal) return () => undefined;
    const abort = () => handler("", { name: "escape", ctrl: true } as Key);
    signal.addEventListener("abort", abort, { once: true });
    this.abortCleanup = () => signal.removeEventListener("abort", abort);
    return this.abortCleanup;
  }
  unbind() { if (this.handler) this.input.off("keypress", this.handler); this.handler = undefined; this.abortCleanup?.(); this.abortCleanup = undefined; }
  get active() { return this.entered; }
  dispose() {
    this.unbind(); if (!this.entered) return;
    this.output.off?.("resize", this.onResize); this.input.setRawMode?.(this.previousRaw);
    if (this.previouslyPaused || !this.previousDataListeners.length) this.input.pause?.();
    this.output.write(`${this.color ? `${ESC}[0m` : ""}${ESC}[?25h${ESC}[?1049l`); this.entered = false;
  }
}
