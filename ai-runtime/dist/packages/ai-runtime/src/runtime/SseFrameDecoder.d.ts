/** Stateful UTF-8 SSE line decoder, isolated from network transport. */
export declare class SseFrameDecoder {
    private readonly doneData;
    private readonly maxEventBytes;
    private readonly decoder;
    private pending;
    private dataLines;
    stopped: boolean;
    constructor(doneData: string, maxEventBytes: number);
    push(bytes: Uint8Array): string[];
    finish(): string[];
    private decode;
    private consume;
    private line;
    private frame;
}
