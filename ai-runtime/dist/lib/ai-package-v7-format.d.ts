import type { AppInteractionConfig } from "../domain/flow/types.ts";
import { type AiProjectV6, type RuntimeBundleV6, type V6FlowNode } from "./ai-package-v6-format.ts";
export declare const AI_FORMAT_VERSION_7: 7;
export type RuntimeBundleV7 = RuntimeBundleV6;
export type V7FlowNode = V6FlowNode;
export type AiProjectV7 = Omit<AiProjectV6, "formatVersion" | "interaction"> & {
    formatVersion: 7;
    interaction?: AppInteractionConfig;
};
export declare function buildAiPackageV7Files(project: Omit<AiProjectV7, "formatVersion">, timestamp?: string): Record<string, string>;
export declare function createAiPackageV7(project: Omit<AiProjectV7, "formatVersion">, timestamp?: string): Blob;
export declare function parseAiPackageV7(buffer: ArrayBuffer, fallbackName?: string): Promise<AiProjectV7>;
export declare function isV7Manifest(value: unknown): boolean;
