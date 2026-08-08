import type { ModelEvent } from "./runtime/contracts/ModelPort.ts";
import type { AiStreamEvent, RuntimeEvent } from "./runtime-types.ts";
export type RuntimeInputComponent = "input" | "checkbox" | "button";
export type RuntimeInputSize = "small" | "medium" | "large";
export type RuntimeInputLayout = "single" | "two-column" | "three-column";
export type RuntimeInputField = {
    id: string;
    variable: string;
    variableType: string;
    label: string;
    component: RuntimeInputComponent;
    size: RuntimeInputSize;
    placeholder?: string;
    buttonValue?: string;
};
export type RuntimeInputRequest = {
    projectName: string;
    node: {
        id: string;
        title: string;
    };
    form: {
        layout: RuntimeInputLayout;
        fields: RuntimeInputField[];
    };
    variables: Readonly<Record<string, unknown>>;
    validationError?: string;
    signal: AbortSignal;
};
export type RuntimeRendererStart = {
    projectName: string;
    model: string;
    signal: AbortSignal;
    cancel(reason?: unknown): void;
};
export type RuntimeRendererResult = {
    status: "completed" | "paused";
    output: unknown;
    elapsedMs: number;
};
export interface RuntimeRenderer {
    start?(context: RuntimeRendererStart): void | Promise<void>;
    requestInput(request: RuntimeInputRequest): Promise<Record<string, unknown>>;
    onModelEvent?(event: ModelEvent): void;
    onStreamEvent?(event: AiStreamEvent): void;
    onRuntimeEvent?(event: RuntimeEvent): void;
    complete?(result: RuntimeRendererResult): void | Promise<void>;
    fail?(error: unknown): void | Promise<void>;
    dispose?(): void | Promise<void>;
}
