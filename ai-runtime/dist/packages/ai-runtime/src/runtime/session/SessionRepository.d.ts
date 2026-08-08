import type { LocalAppStore, SessionRecord, SessionSummary } from "../../app-storage.ts";
export declare class SessionRepository {
    #private;
    private readonly store;
    private readonly persistent;
    constructor(store: LocalAppStore, persistent: boolean);
    assertOpen(): void;
    read(id: string): Promise<SessionRecord>;
    save(session: SessionRecord): Promise<void>;
    create(title?: string): Promise<SessionRecord>;
    list(): Promise<SessionSummary[]>;
    delete(id: string): Promise<void>;
    dispose(): void;
}
