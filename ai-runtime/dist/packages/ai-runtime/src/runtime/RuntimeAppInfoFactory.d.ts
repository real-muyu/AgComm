import type { AiAppInfo } from "../runtime-types.ts";
import type { RuntimeFormatVersion, RuntimeProject } from "./PackageParser.ts";
export declare function createRuntimeAppInfo(project: RuntimeProject, formatVersion: RuntimeFormatVersion, packageHash: string): AiAppInfo;
