import type { AppInteractionConfig } from "../../../domain/flow/types.ts";
import type { AppInteractionOptions } from "./model-types.ts";
import { fail } from "./model-values.ts";

type ConversationConfig = NonNullable<AppInteractionConfig["conversation"]>;
type KnowledgeConfig = NonNullable<AppInteractionConfig["knowledge"]>;
type StreamingConfig = NonNullable<AppInteractionConfig["streaming"]>;

function assertIntegerRange(value: number, minimum: number, maximum: number, path: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("INVALID_INTERACTION", `${path} 必须为 ${minimum}–${maximum}`);
  }
}

function normalizeConversation(value: AppInteractionOptions["conversation"]): ConversationConfig | undefined {
  if (!value) return undefined;
  const history = value.history === true;
  const historyWindow = value.historyWindow ?? 20;
  assertIntegerRange(historyWindow, 1, 100, "conversation.historyWindow");
  return { multiTurn: history || value.multiTurn === true, history, historyWindow };
}

function normalizeKnowledge(value: AppInteractionOptions["knowledge"], history: boolean): KnowledgeConfig | undefined {
  if (!value) return undefined;
  const knowledge: KnowledgeConfig = {
    enabled: true,
    scopes: [...(value.scopes ?? ["app"])],
    topK: value.topK ?? 6,
    chunkSize: value.chunkSize ?? 1200,
    chunkOverlap: value.chunkOverlap ?? 200,
  };
  assertIntegerRange(knowledge.topK!, 1, 20, "knowledge.topK");
  assertIntegerRange(knowledge.chunkSize!, 200, 8000, "knowledge.chunkSize");
  assertIntegerRange(knowledge.chunkOverlap!, 0, 2000, "knowledge.chunkOverlap");
  if (knowledge.scopes?.includes("session") && !history) {
    fail("SESSION_KNOWLEDGE_REQUIRES_HISTORY", "会话级知识库要求 conversation.history=true");
  }
  if (knowledge.chunkOverlap! >= knowledge.chunkSize!) {
    fail("INVALID_INTERACTION", "knowledge.chunkOverlap 必须小于 chunkSize");
  }
  return knowledge;
}

function normalizeStreaming(value: AppInteractionOptions["streaming"]): StreamingConfig | undefined {
  if (!value) return undefined;
  if (value.defaultMode !== "text" && value.defaultMode !== "events") {
    fail("INVALID_INTERACTION", "streaming.defaultMode 必须为 text 或 events");
  }
  return { defaultMode: value.defaultMode };
}

export function normalizeInteraction(value: AppInteractionOptions | undefined): AppInteractionConfig | undefined {
  if (!value) return undefined;
  const conversation = normalizeConversation(value.conversation);
  const knowledge = normalizeKnowledge(value.knowledge, conversation?.history === true);
  const streaming = normalizeStreaming(value.streaming);
  return {
    ...(conversation ? { conversation } : {}),
    ...(knowledge ? { knowledge } : {}),
    ...(streaming ? { streaming } : {}),
  };
}
