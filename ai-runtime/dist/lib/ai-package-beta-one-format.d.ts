import { type AiProjectV7, type RuntimeBundleV7 } from "./ai-package-v7-format.ts";
export declare const AI_FORMAT_VERSION_BETA_1: 8;
export type RuntimeBundleKindBeta1 = "plugin" | "code" | "workspace-hook" | "flow-hook";
export type RuntimeBundleBeta1 = Omit<RuntimeBundleV7, "kind"> & {
    kind: RuntimeBundleKindBeta1;
};
export type AiProjectBeta1 = Omit<AiProjectV7, "formatVersion" | "plugins"> & {
    formatVersion: 8;
    plugins: RuntimeBundleBeta1[];
    flowHookIds?: string[];
};
export declare function buildAiPackageBeta1Files(project: Omit<AiProjectBeta1, "formatVersion">, timestamp?: string): Record<string, string>;
export declare function createAiPackageBeta1(project: Omit<AiProjectBeta1, "formatVersion">, timestamp?: string): Blob;
export declare function parseAiPackageBeta1(buffer: ArrayBuffer, fallbackName?: string): Promise<AiProjectBeta1>;
export declare function isBeta1Manifest(value: unknown): boolean;
