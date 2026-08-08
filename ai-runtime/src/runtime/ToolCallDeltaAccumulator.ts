import { AiRuntimeError } from "../errors.ts";
import type { ModelEvent } from "./contracts/ModelPort.ts";
import type { SseResponseMapping } from "../provider-contracts.ts";

type ToolDelta = { id: string; name: string; arguments: string };
type Pointer = (value: unknown, pointer: string) => unknown | symbol;
type Text = (value: unknown) => string;

/** Accumulates ordered SSE tool-call fragments without owning provider-specific pointer semantics. */
export class ToolCallDeltaAccumulator {
  private readonly deltas = new Map<number, ToolDelta>();
  constructor(private readonly mapping: SseResponseMapping, private readonly missing: symbol, private readonly pointer: Pointer, private readonly text: Text, private readonly onEvent?: (event: ModelEvent) => void) {}
  append(payload: unknown) {
    if (!this.mapping.toolCallDeltasPointer || !this.mapping.toolCall) return;
    const calls = this.pointer(payload, this.mapping.toolCallDeltasPointer);
    if (calls === this.missing) return;
    if (!Array.isArray(calls)) throw new AiRuntimeError("HTTP_SSE_INVALID", "Mapped SSE tool call deltas value must be an array");
    for (const raw of calls) {
      const rawIndex = this.pointer(raw, this.mapping.toolCall.indexPointer); const index = typeof rawIndex === "number" ? rawIndex : Number(rawIndex);
      if (!Number.isInteger(index) || index < 0 || index > 1_000) throw new AiRuntimeError("HTTP_SSE_INVALID", "SSE tool call delta has an invalid index");
      const current = this.deltas.get(index) ?? { id: "", name: "", arguments: "" };
      const id = this.mapping.toolCall.idPointer ? this.text(this.pointer(raw, this.mapping.toolCall.idPointer)) : "";
      const name = this.text(this.pointer(raw, this.mapping.toolCall.namePointer)); const rawArgs = this.pointer(raw, this.mapping.toolCall.argumentsPointer);
      const argumentsText = rawArgs === this.missing || rawArgs == null ? "" : typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);
      current.id += id; current.name += name; current.arguments += argumentsText; this.deltas.set(index, current);
      this.onEvent?.({ type: "tool-call-delta", index, ...(id ? { id } : {}), ...(name ? { name } : {}), ...(argumentsText ? { arguments: argumentsText } : {}) });
    }
  }
  complete(parseArguments: (value: unknown) => unknown) {
    return [...this.deltas.entries()].sort(([left], [right]) => left - right).map(([index, delta]) => {
      if (!delta.name) throw new AiRuntimeError("HTTP_SSE_INVALID", `SSE tool call ${index} has no name`);
      return { id: delta.id || `call_${index}`, name: delta.name, args: parseArguments(delta.arguments) };
    });
  }
}
