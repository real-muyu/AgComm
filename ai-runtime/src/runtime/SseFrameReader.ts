import { SseFrameDecoder } from "./SseFrameDecoder.ts";
import { SseBodyReader } from "./SseBodyReader.ts";

/** Reads strict SSE data frames while enforcing transport and per-event limits. */
export async function* readSseFrames(response: Response, signal: AbortSignal, options: { doneData: string; maxResponseBytes: number; maxEventBytes: number }) {
  const reader = new SseBodyReader(response, signal, options.maxResponseBytes);
  const decoder = new SseFrameDecoder(options.doneData, options.maxEventBytes);
  try {
    while (!decoder.stopped) {
      const { done, value } = await reader.read(); if (done) break;
      yield* decoder.push(value);
    }
    if (decoder.stopped) await reader.cancel("SSE complete");
    else yield* decoder.finish();
  } finally { await reader.close(); }
}
