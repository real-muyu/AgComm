import { type AiProjectBeta1 } from "../../../lib/ai-package-beta-one-format.ts";
import { type AppDefinition } from "./model.ts";
export type CompiledApp = {
    readonly formatVersion: 8;
    readonly project: AiProjectBeta1;
};
export type BuildResult = {
    readonly path: string;
    readonly byteLength: number;
    readonly compiled: CompiledApp;
};
export declare function compileApp(app: AppDefinition): Promise<CompiledApp>;
export declare function buildAi(app: AppDefinition): Promise<Uint8Array>;
export declare function writeAi(app: AppDefinition, path: string | URL): Promise<BuildResult>;
export declare function fileUrl(path: string): import("url").URL;
