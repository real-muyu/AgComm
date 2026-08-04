export declare class OutboundSecurityError extends Error {
    readonly status = 400;
    constructor(message: string);
}
export declare function validateResolvedPublicUrl(value: string | URL, options: {
    signal: AbortSignal;
}): Promise<URL>;
export declare function createSafeOutboundFetch(options: {
    maxRedirects?: number;
    maxResponseBytes?: number;
    signal: AbortSignal;
    fetcher?: typeof globalThis.fetch;
}): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
