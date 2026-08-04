import type { FlowProject, Plugin } from "../domain/flow/types.ts";
export declare const AI_FORMAT_VERSION_5: 5;
export type V5FlowNode = Omit<FlowProject["nodes"][number], "type"> & {
    type: FlowProject["nodes"][number]["type"] | "CODE" | "CONTACT";
};
export type AiProjectV5 = Omit<FlowProject, "nodes"> & {
    formatVersion: 5;
    nodes: V5FlowNode[];
};
export declare function buildAiPackageV5Files(project: Omit<AiProjectV5, "formatVersion">, timestamp?: string): Record<string, string>;
export declare function createAiPackageV5(project: Omit<AiProjectV5, "formatVersion">, timestamp?: string): Blob;
export declare function parseAiPackageV5(buffer: ArrayBuffer, fallbackName?: string): Promise<AiProjectV5>;
export declare function isV5Manifest(value: unknown): boolean;
export type { Plugin };
