export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type PluginToolManifest = {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    permissions?: string[];
};
export type PluginSignature = {
    algorithm: "Ed25519";
    keyId: string;
    value: string;
};
export type SignedPluginManifest = {
    id: string;
    name: string;
    description: string;
    version: string;
    sdkVersion: "1";
    language: "typescript";
    entry: "dist/index.js";
    runtime?: "server";
    source?: "custom";
    kind?: "plugin" | "code" | "workspace-hook" | "flow-hook";
    permissions: string[];
    tools: PluginToolManifest[];
    limits?: {
        timeoutMs?: number;
        maxOutputBytes?: number;
        maxConcurrency?: number;
    };
    integrity: string;
    signature: PluginSignature;
};
export type PluginRegistryEntry = {
    manifest: SignedPluginManifest;
    workerName: string;
};
export type TrustedPluginRegistryEntry = PluginRegistryEntry & {
    workspaceTrusted: true;
};
export type VerifiedPlugin = PluginRegistryEntry & {
    verifiedAt: number;
};
export type PluginReference = {
    id?: string;
    version?: string;
    integrity?: string;
};
export type PluginRuntimeStatus = {
    id: string;
    version: string;
    registered: boolean;
    signatureValid: boolean;
    sandboxAvailable: boolean;
    runtimeAvailable: boolean;
    permissions: string[];
    tools: Array<{
        name: string;
        description: string;
        permissions: string[];
    }>;
    reason?: string;
};
export type DispatchNamespace = {
    get(name: string, args?: Record<string, unknown>, options?: Record<string, unknown>): {
        fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
};
export type PluginExecutionRequest = {
    plugin: VerifiedPlugin;
    operation: string;
    input: Record<string, unknown>;
    grantedPermissions: string[];
    signal: AbortSignal;
    audit?: (event: PluginAuditEvent) => void | Promise<void>;
};
export type PluginWorkerRequest = {
    operation: string;
    input: Record<string, unknown>;
    grantedPermissions: string[];
};
export type PluginWorkerResult = {
    result?: JsonValue;
    error?: string;
    code?: string;
};
export type PluginAuditEvent = {
    type: "plugin:start" | "plugin:complete" | "plugin:error";
    invocationId: string;
    pluginId: string;
    version: string;
    operation: string;
    at: number;
    durationMs?: number;
    error?: string;
};
export interface PluginExecutionAdapter {
    execute(request: PluginExecutionRequest): Promise<JsonValue>;
}
