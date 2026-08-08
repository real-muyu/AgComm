import type { SessionRecord } from "../../app-storage.ts";
import { AiRuntimeError } from "../../errors.ts";
import type { AiRunResult, AiSessionHandle, AiStreamEvent, AiStreamMode, SessionRunOptions } from "../../runtime-types.ts";
import type { RuntimeProject } from "../ProjectExecutor.ts";
import { safeText } from "../PluginManager.ts";
import { createAiRunStream } from "../StreamPublisher.ts";
import type { SessionKnowledgeResolver } from "./SessionKnowledgeResolver.ts";
import type { SessionRepository } from "./SessionRepository.ts";

export type SessionExecution = (
  options: SessionRunOptions & { input: string },
  context: { packageHash: string; sessionId: string; history: SessionRecord["messages"]; knowledgeContext: string },
) => Promise<AiRunResult>;

export function createRuntimeSessionHandle(options: {
  initial: SessionRecord;
  repository: SessionRepository;
  knowledge: SessionKnowledgeResolver;
  project: RuntimeProject;
  packageHash: string;
  execute: SessionExecution;
}): AiSessionHandle {
  let current = options.initial;
  let disposed = false;
  const assertOpen = () => {
    if (disposed) throw new AiRuntimeError("SESSION_DISPOSED", "Session handle has been disposed");
  };

  async function turn(input: string, runOptions: SessionRunOptions = {}): Promise<AiRunResult> {
    assertOpen();
    current = await options.repository.read(current.id);
    const createdAt = new Date().toISOString();
    try {
      const result = await executeTurn(options, current, input, runOptions);
      recordSuccess(current, input, createdAt, result);
      await options.repository.save(current);
      return result;
    } catch (error) {
      recordFailure(current, input, createdAt, error);
      await options.repository.save(current);
      throw error;
    }
  }

  return {
    get id() { return current.id; },
    get title() { return current.title; },
    async history() {
      assertOpen();
      current = await options.repository.read(current.id);
      return structuredClone(current.messages);
    },
    async rename(title) {
      assertOpen();
      current = await options.repository.read(current.id);
      current.title = title.trim().slice(0, 120) || current.title;
      current.updatedAt = new Date().toISOString();
      await options.repository.save(current);
    },
    runTurn: turn,
    streamTurn: createStreamTurn(turn, options.project),
    async dispose() { disposed = true; },
  };
}

async function executeTurn(
  options: Parameters<typeof createRuntimeSessionHandle>[0],
  session: SessionRecord,
  input: string,
  runOptions: SessionRunOptions,
): Promise<AiRunResult> {
  const historyWindow = options.project.interaction?.conversation?.historyWindow ?? 20;
  return options.execute(
    { ...runOptions, input },
    {
      packageHash: options.packageHash,
      sessionId: session.id,
      history: session.messages.slice(-historyWindow),
      knowledgeContext: await options.knowledge.resolve(input, session.id, runOptions.signal),
    },
  );
}

function recordSuccess(session: SessionRecord, input: string, createdAt: string, result: AiRunResult): void {
  session.messages.push(
    { role: "user", content: input, createdAt },
    { role: "assistant", content: safeText(result.output), createdAt: new Date().toISOString() },
  );
  session.turns.push({ id: crypto.randomUUID(), input, status: "completed", output: result.output, elapsedMs: result.elapsedMs, createdAt });
  if (session.messages.length === 2 && session.title === "新会话") {
    session.title = input.trim().replace(/\s+/g, " ").slice(0, 48) || session.title;
  }
  session.updatedAt = new Date().toISOString();
}

function recordFailure(session: SessionRecord, input: string, createdAt: string, error: unknown): void {
  session.messages.push({ role: "user", content: input, createdAt });
  session.turns.push({
    id: crypto.randomUUID(),
    input,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    createdAt,
  });
  session.updatedAt = new Date().toISOString();
}

function createStreamTurn(
  turn: (input: string, options?: SessionRunOptions) => Promise<AiRunResult>,
  project: RuntimeProject,
): AiSessionHandle["streamTurn"] {
  return ((input: string, streamOptions: SessionRunOptions & { mode?: AiStreamMode } = {}) => {
    const { mode: requested, signal: externalSignal, onStreamEvent, onOutputDelta, ...rest } = streamOptions;
    const mode = requested ?? project.interaction?.streaming?.defaultMode ?? "text";
    return createAiRunStream<string | AiStreamEvent>((signal, push) => turn(input, {
      ...rest,
      signal,
      mode,
      onStreamEvent(event) {
        onStreamEvent?.(event);
        if (mode === "events") push(event);
      },
      onOutputDelta(text) {
        onOutputDelta?.(text);
        if (mode === "text") push(text);
      },
    }), { externalSignal, closeOnError: mode === "events" });
  }) as AiSessionHandle["streamTurn"];
}
