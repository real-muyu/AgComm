import type { Socket } from "node:net";
import type { GatewayRunRecord, GatewayRunStream } from "../gateway/RuntimeGateway.ts";
export declare class GatewayRunStreamConnection {
    private readonly socket;
    private readonly resolveStream;
    private readonly rejectStream;
    private buffer;
    private acknowledged;
    private consumed;
    private closed;
    private cursor;
    private readonly queue;
    private wake?;
    private terminalError?;
    private resolveCompletion;
    private rejectCompletion;
    readonly completion: Promise<GatewayRunRecord>;
    constructor(socket: Socket, afterSequence: number | undefined, resolveStream: (stream: GatewayRunStream) => void, rejectStream: (error: unknown) => void);
    private notify;
    fail(error: unknown): void;
    closeUnexpectedly(): void;
    onData(chunk: string): void;
    private parse;
    private accept;
    private acknowledge;
    private createStream;
    private destroy;
}
