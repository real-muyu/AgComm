import type { FlowProject, Plugin } from "../domain/flow/types.ts";
export declare const AI_FORMAT_VERSION_3: 3;
export type CodeFlowNode = Omit<FlowProject["nodes"][number], "type"> & {
    type: FlowProject["nodes"][number]["type"] | "CODE";
};
export type AiProjectV3 = Omit<FlowProject, "nodes"> & {
    formatVersion: 3;
    nodes: CodeFlowNode[];
};
export declare function buildAiPackageV3Files(project: Omit<AiProjectV3, "formatVersion">, timestamp?: string): Record<string, string>;
export declare function createAiPackageV3(project: Omit<AiProjectV3, "formatVersion">, timestamp?: string): Blob;
export declare function parseAiPackageV3(buffer: ArrayBuffer, fallbackName?: string): Promise<AiProjectV3>;
export declare function isV3Manifest(value: unknown): boolean;
export type { Plugin };
