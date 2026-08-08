/** Reads strict SSE data frames while enforcing transport and per-event limits. */
export declare function readSseFrames(response: Response, signal: AbortSignal, options: {
    doneData: string;
    maxResponseBytes: number;
    maxEventBytes: number;
}): AsyncGenerator<string, void, unknown>;
