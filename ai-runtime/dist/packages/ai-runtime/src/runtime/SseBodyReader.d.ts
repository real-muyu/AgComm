export declare class SseBodyReader {
    private readonly signal;
    private readonly maximum;
    private readonly reader;
    private total;
    constructor(response: Response, signal: AbortSignal, maximum: number);
    read(): Promise<ReadableStreamReadResult<Uint8Array<ArrayBufferLike>>>;
    cancel(reason: unknown): Promise<void>;
    close(): Promise<void>;
}
