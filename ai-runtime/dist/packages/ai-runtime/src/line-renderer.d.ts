import type { RuntimeRenderer } from "./renderer.ts";
export type LineRendererInput = NodeJS.ReadableStream;
export type LineRendererOutput = NodeJS.WritableStream;
export type LineRendererOptions = {
    input?: LineRendererInput;
    output?: LineRendererOutput;
    interactive?: boolean;
    formatError?: (error: unknown) => string;
};
export declare function createLineRenderer(options?: LineRendererOptions): RuntimeRenderer;
