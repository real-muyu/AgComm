import type { RuntimeInputRequest } from "./renderer.ts";
type FormIo = {
    ask(prompt: string, signal: AbortSignal): Promise<string>;
    write(value: string): void;
    text(value: unknown): string;
    valueText(value: unknown): string;
};
export declare function requestLineForm(request: RuntimeInputRequest, values: Record<string, unknown>, io: FormIo): Promise<Record<string, unknown>>;
export {};
