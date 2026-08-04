export declare class AiRuntimeError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: ErrorOptions);
}
