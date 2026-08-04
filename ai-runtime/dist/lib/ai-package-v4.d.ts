import type { FlowProject, Plugin } from "../domain/flow/types.ts";
export declare const AI_FORMAT_VERSION_4: 4;
export type CodeFlowNode = Omit<FlowProject["nodes"][number], "type"> & {
    type: FlowProject["nodes"][number]["type"] | "CODE";
};
export type AiProjectV4 = Omit<FlowProject, "nodes"> & {
    formatVersion: 4;
    nodes: CodeFlowNode[];
};
export declare function buildAiPackageV4Files(project: Omit<AiProjectV4, "formatVersion">, timestamp?: string): Record<string, string>;
export declare function createAiPackageV4(project: Omit<AiProjectV4, "formatVersion">, timestamp?: string): Blob;
export declare function parseAiPackageV4(buffer: ArrayBuffer, fallbackName?: string): Promise<AiProjectV4>;
export declare function isV4Manifest(value: unknown): boolean;
export type { Plugin };
