import type { SessionSummary } from "../app-storage.ts";
export type SessionPickerItem = Pick<SessionSummary, "id" | "title" | "messageCount">;
export declare class SessionPickerState {
    private items;
    private selected;
    update(sessions: readonly SessionSummary[]): void;
    move(offset: -1 | 1): void;
    selectedItem(): SessionPickerItem;
    selectedExisting(): SessionPickerItem | undefined;
    afterDelete(): void;
    rows(): string[];
}
