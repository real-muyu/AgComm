import type { AiAppHandle, AiSessionHandle } from "../runtime-types.ts";
import { createTerminalRenderer } from "../terminal-renderer.ts";
import type { TerminalInput, TerminalOutput } from "../terminal-renderer.ts";
import { manageTerminalKnowledge } from "./KnowledgeController.ts";
import type { TerminalScreenPort } from "./TerminalScreenPort.ts";

type ConversationCommand =
  | { type: "continue" }
  | { type: "quit" | "sessions" | "info" | "settings" | "knowledge" }
  | { type: "input"; value: string };
type NavigationCommand = "quit" | "sessions" | "info" | "settings" | "knowledge";

type ConversationOptions = {
  input?: TerminalInput;
  output?: TerminalOutput;
  initialInput?: string;
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
  formatError?: (error: unknown) => string;
  openSettings?: () => Promise<void>;
};

export class ConversationController {
  constructor(
    private readonly screen: TerminalScreenPort,
    private readonly app: AiAppHandle,
    private readonly session: AiSessionHandle,
    private readonly options: ConversationOptions,
  ) {}

  async run(): Promise<"quit" | "sessions"> {
    let pending = this.options.initialInput;
    for (;;) {
      await this.paint();
      const command = pending ? { type: "input", value: pending } as const : await this.readCommand();
      pending = undefined;
      if (command.type === "quit" || command.type === "sessions") return command.type;
      if (command.type === "input") await this.runTurn(command.value);
      else await this.applyCommand(command.type);
    }
  }

  private async paint(): Promise<void> {
    const history = await this.session.history();
    const lines = history.flatMap((message) => [
      `${message.role === "user" ? "You" : "AI"}:`,
      ...message.content.split("\n"),
      "",
    ]);
    this.screen.paint(
      `${this.app.name} · ${this.session.title}`,
      lines,
      "Enter 输入  ·  I 信息  ·  K 知识库  ·  P 设置  ·  S 会话  ·  Q 退出",
    );
  }

  private async readCommand(): Promise<ConversationCommand> {
    const event = await this.screen.key(this.options.signal);
    if (event.key.ctrl && event.key.name === "c") throw new DOMException("Interrupted", "AbortError");
    if (event.key.name === "escape") return { type: "quit" };
    const key = (event.text ?? "").toLowerCase();
    const mapped = this.navigationCommand(key);
    if (mapped) return { type: mapped };
    if (event.key.name !== "return") return { type: "continue" };
    const value = await this.screen.prompt(this.app.name, "输入消息", this.options.signal);
    return value ? { type: "input", value } : { type: "continue" };
  }

  private navigationCommand(key: string): NavigationCommand | undefined {
    if (key === "q") return "quit";
    if (key === "s") return "sessions";
    if (key === "i") return "info";
    if (key === "p" && this.options.openSettings) return "settings";
    if (key === "k" && this.app.interaction?.knowledge) return "knowledge";
    return undefined;
  }

  private async applyCommand(command: "continue" | "info" | "settings" | "knowledge"): Promise<void> {
    if (command === "info") await showAppInfo(this.screen, this.app, this.options.signal);
    if (command === "knowledge") await manageTerminalKnowledge(this.screen, this.app, this.session, this.options.signal);
    if (command === "settings") await this.openSettings();
  }

  private async openSettings(): Promise<void> {
    if (!this.options.openSettings) return;
    this.screen.leave();
    try { await this.options.openSettings(); }
    finally { this.screen.enter(); }
  }

  private async runTurn(input: string): Promise<void> {
    this.screen.leave();
    try {
      await this.session.runTurn(input, {
        variables: this.options.variables,
        signal: this.options.signal,
        renderer: createTerminalRenderer({
          input: this.screen.input,
          output: this.screen.output,
          formatError: this.options.formatError,
          waitOnComplete: false,
        }),
      });
    } finally {
      this.screen.enter();
    }
  }
}

async function showAppInfo(screen: TerminalScreenPort, app: AiAppHandle, signal?: AbortSignal): Promise<void> {
  const lines = [
    `Format: v${app.info.formatVersion}`,
    `Package: ${app.packageHash}`,
    "",
    `Flow (${app.info.nodes.length})`,
    ...app.info.nodes.map((node) => `  ${node.type} · ${node.title} · ${node.id}`),
    "",
    `Bundles (${app.info.bundles.length})`,
    ...app.info.bundles.map((bundle) =>
      `  ${bundle.kind} · ${bundle.name} · ${bundle.runtime} · ${bundle.signed ? "signed" : "unsigned"} · ${bundle.permissions.join(", ") || "no permissions"}`,
    ),
  ];
  screen.paint(`${app.name} · 应用信息`, lines, "任意键返回");
  await screen.key(signal);
}
