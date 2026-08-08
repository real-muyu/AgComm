import type { ModelEvent } from "./contracts/ModelPort.ts";
import type { SseResponseMapping } from "../provider-contracts.ts";
type Pointer = (value: unknown, pointer: string) => unknown | symbol;
type Text = (value: unknown) => string;
/** Accumulates ordered SSE tool-call fragments without owning provider-specific pointer semantics. */
export declare class ToolCallDeltaAccumulator {
    private readonly mapping;
    private readonly missing;
    private readonly pointer;
    private readonly text;
    private readonly onEvent?;
    private readonly deltas;
    constructor(mapping: SseResponseMapping, missing: symbol, pointer: Pointer, text: Text, onEvent?: ((event: ModelEvent) => void) | undefined);
    append(payload: unknown): void;
    complete(parseArguments: (value: unknown) => unknown): {
        id: string;
        name: string;
        args: unknown;
    }[];
}
export {};
