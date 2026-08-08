import type { WorkspaceToolCall, WorkspaceToolDefinition } from "../../../../../lib/workspace-tool-calling.ts";

export type ModelEvent =
  | { type: "token"; text: string }
  | { type: "tool-call-delta"; index: number; id?: string; name?: string; arguments?: string };

export type ModelReply = {
  content: string;
  toolCalls?: WorkspaceToolCall[];
  raw?: unknown;
};

export type ModelProvider = {
  model?: string;
  supportsTools?: boolean;
  call(input: {
    messages: unknown[];
    tools: WorkspaceToolDefinition[];
    forceFinal: boolean;
    signal: AbortSignal;
    onEvent?: (event: ModelEvent) => void;
  }): Promise<ModelReply>;
};

export type ProviderConfig = {
  type?: "openai";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  embeddingModel?: string;
  provider?: ModelProvider;
};
