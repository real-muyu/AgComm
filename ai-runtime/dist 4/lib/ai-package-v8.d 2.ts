import { type AiProjectV7, type RuntimeBundleV7 } from "./ai-package-v7.ts";
export declare const AI_FORMAT_VERSION_8: 8;
export type RuntimeBundleKindV8 = "plugin" | "code" | "workspace-hook" | "flow-hook";
export type RuntimeBundleV8 = Omit<RuntimeBundleV7, "kind"> & {
    kind: RuntimeBundleKindV8;
};
export type AiProjectV8 = Omit<AiProjectV7, "formatVersion" | "plugins"> & {
    formatVersion: 8;
    plugins: RuntimeBundleV8[];
    flowHookIds?: string[];
};
export declare function buildAiPackageV8Files(project: Omit<AiProjectV8, "formatVersion">, timestamp?: string): Record<string, string>;
export declare function createAiPackageV8(project: Omit<AiProjectV8, "formatVersion">, timestamp?: string): Blob;
export declare function parseAiPackageV8(buffer: ArrayBuffer, fallbackName?: string): Promise<AiProjectV8>;
export declare function isV8Manifest(value: unknown): boolean;
