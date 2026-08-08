import type { AiRunResult } from "../runtime-types.ts";
import type { ModelProvider, ProviderConfig } from "./contracts/ModelPort.ts";
export declare class RendererLifecycle {
    private readonly renderer;
    private readonly controller;
    private readonly provider;
    private readonly config;
    constructor(renderer: any, controller: AbortController, provider: ModelProvider, config: ProviderConfig);
    model(): string;
    start(projectName: string): Promise<void>;
    complete(result: AiRunResult): Promise<void>;
    fail(error: unknown): Promise<unknown>;
    dispose(): Promise<unknown>;
}
