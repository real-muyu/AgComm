import type { PermissionAdapter } from "./plugin-sandbox.ts";
export type RuntimePathRequest = {
    mode: "read" | "write";
    kind: "file" | "document";
    extensions?: readonly string[];
};
export type RuntimePathSelector = (request: RuntimePathRequest, signal: AbortSignal) => Promise<string | undefined>;
export declare function createNativePermissionAdapter(options?: {
    selectPath?: RuntimePathSelector;
}): PermissionAdapter;
