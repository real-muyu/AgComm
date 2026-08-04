import { AiRuntimeError } from "./errors.ts";
import type { ModelEvent } from "./model-provider.ts";
import type { FlowProject } from "../../../domain/flow/types.ts";
import type { ModelReply } from "./model-provider.ts";
import type { AiRunResult, AiRunStream, ModelInvocationContext } from "./runtime-types.ts";

const MAX_BUFFER_BYTES = 1_048_576;

function itemBytes(value: unknown) {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
  catch { return MAX_BUFFER_BYTES + 1; }
}

class AsyncRunQueue<T> {
  private readonly values: Array<{ value: T; bytes: number }> = [];
  private readonly waiters: Array<{ resolve(value: IteratorResult<T>): void; reject(error: unknown): void }> = [];
  private bufferedBytes = 0;
  private closed = false;
  private failure?: unknown;

  push(value: T) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) { waiter.resolve({ done: false, value }); return; }
    const bytes = itemBytes(value);
    if (this.bufferedBytes + bytes > MAX_BUFFER_BYTES) {
      throw new AiRuntimeError("STREAM_BACKPRESSURE_EXCEEDED", "Stream consumer buffer exceeds 1 MiB");
    }
    this.values.push({ value, bytes });
    this.bufferedBytes += bytes;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  fail(error: unknown) {
    if (this.closed) return;
    this.failure = error;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next(): Promise<IteratorResult<T>> {
    const item = this.values.shift();
    if (item) {
      this.bufferedBytes -= item.bytes;
      return Promise.resolve({ done: false, value: item.value });
    }
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

export function createAiRunStream<T>(
  execute: (signal: AbortSignal, push: (value: T) => void) => Promise<AiRunResult>,
  options: { externalSignal?: AbortSignal; errorAsItem?: (error: unknown) => T | undefined; closeOnError?: boolean } = {},
): AiRunStream<T> {
  const controller = new AbortController();
  const queue = new AsyncRunQueue<T>();
  let iterated = false;
  const abortFromExternal = () => controller.abort(options.externalSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  if (options.externalSignal?.aborted) abortFromExternal();
  else options.externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const result = Promise.resolve().then(() => execute(controller.signal, (value) => {
    try { queue.push(value); }
    catch (error) { controller.abort(error); throw error; }
  }));
  void result.then(
    () => queue.close(),
    (error) => {
      const item = options.errorAsItem?.(error);
      if (item !== undefined) {
        try { queue.push(item); queue.close(); }
        catch (pushError) { queue.fail(pushError); }
      } else if (options.closeOnError) queue.close();
      else queue.fail(error);
    },
  ).finally(() => options.externalSignal?.removeEventListener("abort", abortFromExternal));
  return {
    result,
    signal: controller.signal,
    cancel(reason) {
      if (!controller.signal.aborted) controller.abort(reason ?? new DOMException("Stream cancelled", "AbortError"));
    },
    [Symbol.asyncIterator]() {
      if (iterated) throw new AiRuntimeError("STREAM_ALREADY_CONSUMED", "A run stream can only be consumed once");
      iterated = true;
      return {
        next: () => queue.next(),
        return: async () => {
          if (!controller.signal.aborted) controller.abort(new DOMException("Stream consumer stopped", "AbortError"));
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export function streamError(error: unknown) {
  const value = error as { code?: unknown; name?: unknown; message?: unknown };
  return {
    code: String(value?.code ?? "RUNTIME_FAILED"),
    name: String(value?.name ?? "Error"),
    message: String(value?.message ?? error ?? "Runtime failed").slice(0, 4_096),
  };
}

const EXACT_REFERENCE = /^\{\{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\}\}$/;

export function outputText(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try { return JSON.stringify(value); }
  catch { return String(value ?? ""); }
}

export class OutputStreamCoordinator {
  private readonly outputNodeId?: string;
  private readonly sourceNodeId?: string;
  private readonly sourceSafe: boolean;
  private readonly modelBuffers = new Map<string, string[]>();
  private emitted = "";
  private completed = false;

  constructor(
    project: Pick<FlowProject, "nodes" | "edges" | "plugins">,
    private readonly publish: (text: string, nodeId?: string) => void,
  ) {
    const outputs = project.nodes.filter((node) => node.type === "OUTPUT");
    if (outputs.length !== 1) {
      this.sourceSafe = false;
      return;
    }
    const output = outputs[0];
    this.outputNodeId = output.id;
    const template = output.config?.template;
    const match = typeof template === "string" ? EXACT_REFERENCE.exec(template) : undefined;
    if (!match) {
      this.sourceSafe = false;
      return;
    }
    const path = match[1];
    let source = path === "previous.output"
      ? (() => {
          const incoming = project.edges.filter((edge) => edge.to === output.id);
          return incoming.length === 1 ? project.nodes.find((node) => node.id === incoming[0].from) : undefined;
        })()
      : project.nodes.find((node) => node.outputVar === path.split(".")[0]);
    if (source?.type !== "SKILL" && source?.type !== "WORKSPACE") source = undefined;
    this.sourceNodeId = source?.id;
    if (!source) {
      this.sourceSafe = false;
      return;
    }
    if (source.type === "WORKSPACE") {
      const hookIds = Array.isArray(source.config?.hookIds) ? source.config.hookIds.map(String) : [];
      this.sourceSafe = !project.plugins.some((plugin) => hookIds.includes(plugin.id)
        && plugin.tools.some((tool) => tool.name === "afterModel" || tool.name === "onFinish"));
    } else this.sourceSafe = true;
  }

  beginModel(context: ModelInvocationContext) {
    if (!this.sourceSafe || context.nodeId !== this.sourceNodeId) return;
    if (!context.forceFinal) this.modelBuffers.set(context.callId, []);
  }

  modelEvent(context: ModelInvocationContext, event: ModelEvent) {
    if (!this.sourceSafe || context.nodeId !== this.sourceNodeId || event.type !== "token" || !event.text) return;
    const buffer = this.modelBuffers.get(context.callId);
    if (buffer) buffer.push(event.text);
    else if (context.forceFinal) this.emit(event.text);
  }

  completeModel(context: ModelInvocationContext, reply: ModelReply) {
    const buffer = this.modelBuffers.get(context.callId);
    this.modelBuffers.delete(context.callId);
    if (!buffer || reply.toolCalls?.length) return;
    for (const text of buffer) this.emit(text);
  }

  completeOutput(nodeId: string, output: unknown) {
    if (nodeId !== this.outputNodeId) return;
    this.complete(output, nodeId);
  }

  completeRun(output: unknown) {
    if (!this.completed) this.complete(output, this.outputNodeId);
  }

  private emit(text: string, nodeId = this.outputNodeId) {
    if (!text) return;
    this.emitted += text;
    this.publish(text, nodeId);
  }

  private complete(output: unknown, nodeId?: string) {
    const finalText = outputText(output);
    if (!this.emitted) this.emit(finalText, nodeId);
    else if (finalText.startsWith(this.emitted)) this.emit(finalText.slice(this.emitted.length), nodeId);
    else {
      throw new AiRuntimeError(
        "STREAM_OUTPUT_MISMATCH",
        `Streamed output does not match final OUTPUT node${nodeId ? ` ${nodeId}` : ""}`,
      );
    }
    this.completed = true;
  }
}
