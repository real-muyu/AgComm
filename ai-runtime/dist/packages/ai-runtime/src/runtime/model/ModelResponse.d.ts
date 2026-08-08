import type { AIMessageChunk } from "@langchain/core/messages";
import type { ModelEvent, ModelReply } from "../contracts/ModelPort.ts";
export declare function modelReply(response: {
    content: unknown;
    tool_calls?: unknown;
}): ModelReply;
export declare function streamModelReply(stream: AsyncIterable<AIMessageChunk>, emit: (event: ModelEvent) => void): Promise<ModelReply>;
