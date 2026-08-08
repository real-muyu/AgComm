import type { RuntimeRenderer } from "../renderer.ts";
import type { AiStreamEventInput, RunAiOptions, RuntimeEvent } from "../runtime-types.ts";
export { createAiRunStream, OutputStreamCoordinator, streamError } from "../streaming.ts";
export declare class StreamPublisher {
    private readonly options;
    private readonly renderer?;
    private sequence;
    private callbackEnabled;
    constructor(options: RunAiOptions, renderer?: RuntimeRenderer | undefined);
    publish(value: AiStreamEventInput): void;
    output(text: string, nodeId?: string): void;
    runtime(event: RuntimeEvent): void;
}
