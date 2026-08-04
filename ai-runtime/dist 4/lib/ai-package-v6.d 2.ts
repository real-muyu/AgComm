import type { FlowProject, Plugin } from "../domain/flow/types.ts";
export declare const AI_FORMAT_VERSION_6: 6;
export type RuntimeBundleKindV6 = "plugin" | "code" | "workspace-hook";
export type RuntimeBundleV6 = Plugin & {
    kind: RuntimeBundleKindV6;
};
export type V6FlowNode = Omit<FlowProject["nodes"][number], "type"> & {
    type: FlowProject["nodes"][number]["type"] | "CODE" | "CONTACT";
};
export type AiProjectV6 = Omit<FlowProject, "nodes" | "plugins"> & {
    formatVersion: 6;
    nodes: V6FlowNode[];
    plugins: RuntimeBundleV6[];
};
export declare function buildAiPackageV6Files(project: Omit<AiProjectV6, "formatVersion">, timestamp?: string): Record<string, string>;
export declare function createAiPackageV6(project: Omit<AiProjectV6, "formatVersion">, timestamp?: string): Blob;
export declare function parseAiPackageV6(buffer: ArrayBuffer, fallbackName?: string): Promise<AiProjectV6>;
export declare function isV6Manifest(value: unknown): boolean;
