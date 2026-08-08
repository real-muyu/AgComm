export type HttpProviderAuth = {
    type: "none";
} | {
    type: "bearer";
    tokenEnv: string;
} | {
    type: "apiKey";
    header: string;
    valueEnv: string;
} | {
    type: "basic";
    usernameEnv: string;
    passwordEnv: string;
};
export type ToolCallMapping = {
    idPointer?: string;
    namePointer: string;
    argumentsPointer: string;
};
export type JsonResponseMapping = {
    mode: "json";
    contentPointer: string;
    toolCallsPointer?: string;
    toolCall?: ToolCallMapping;
};
export type SseResponseMapping = {
    mode: "sse";
    doneData?: string;
    contentDeltaPointer: string;
    toolCallDeltasPointer?: string;
    toolCall?: ToolCallMapping & {
        indexPointer: string;
    };
};
export type RequestTransformContext = {
    messages: unknown[];
    tools: unknown[];
    model: string;
    temperature: number;
    maxTokens: number;
    forceFinal: boolean;
};
export type RequestTransformResult = {
    body: unknown;
    query?: Record<string, string | number | boolean | null | Array<string | number | boolean>>;
    headers?: Record<string, string>;
};
export type HttpModelProviderConfig = {
    type: "http";
    url: string;
    method?: "POST" | "PUT" | "PATCH";
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
    auth?: HttpProviderAuth;
    requestTransformer: string | ((context: RequestTransformContext) => RequestTransformResult | Promise<RequestTransformResult>);
    response: JsonResponseMapping | SseResponseMapping;
    environment?: Readonly<Record<string, string | undefined>>;
    fetcher?: typeof globalThis.fetch;
};
