import type { LocalAppStore, SessionRecord, SessionSummary } from "../../app-storage.ts";
import { AiRuntimeError } from "../../errors.ts";

export class SessionRepository {
  readonly #memory = new Map<string, SessionRecord>();
  #disposed = false;

  constructor(
    private readonly store: LocalAppStore,
    private readonly persistent: boolean,
  ) {}

  assertOpen(): void {
    if (this.#disposed) throw new AiRuntimeError("APP_DISPOSED", "AI app handle has been disposed");
  }

  async read(id: string): Promise<SessionRecord> {
    this.assertOpen();
    if (this.persistent) return this.store.readSession(id);
    const session = this.#memory.get(id);
    if (!session) throw new AiRuntimeError("SESSION_NOT_FOUND", `Session not found: ${id}`);
    return structuredClone(session);
  }

  async save(session: SessionRecord): Promise<void> {
    this.assertOpen();
    if (this.persistent) await this.store.writeSession(session);
    else this.#memory.set(session.id, structuredClone(session));
  }

  async create(title?: string): Promise<SessionRecord> {
    this.assertOpen();
    if (this.persistent) return this.store.createSession(title);
    const now = new Date().toISOString();
    const session: SessionRecord = {
      version: 1,
      id: crypto.randomUUID(),
      title: title?.trim().slice(0, 120) || "新会话",
      createdAt: now,
      updatedAt: now,
      messages: [],
      turns: [],
    };
    this.#memory.set(session.id, structuredClone(session));
    return session;
  }

  async list(): Promise<SessionSummary[]> {
    this.assertOpen();
    if (this.persistent) return this.store.listSessions();
    return [...this.#memory.values()].map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    this.assertOpen();
    if (this.persistent) await this.store.deleteSession(id);
    else this.#memory.delete(id);
  }

  dispose(): void {
    this.#disposed = true;
  }
}

function toSummary(session: SessionRecord): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}
