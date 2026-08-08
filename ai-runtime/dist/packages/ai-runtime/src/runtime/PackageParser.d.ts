import { type AiProjectV3 } from "../../../../lib/ai-package-v3-format.ts";
import { type AiProjectV4 } from "../../../../lib/ai-package-v4-format.ts";
import { type AiProjectV5 } from "../../../../lib/ai-package-v5-format.ts";
import { type AiProjectV6 } from "../../../../lib/ai-package-v6-format.ts";
import { type AiProjectV7 } from "../../../../lib/ai-package-v7-format.ts";
import { type AiProjectBeta1 } from "../../../../lib/ai-package-beta-one-format.ts";
import type { FlowProject } from "../../../../domain/flow/types.ts";
export type RuntimeProject = FlowProject | AiProjectV3 | AiProjectV4 | AiProjectV5 | AiProjectV6 | AiProjectV7 | AiProjectBeta1;
export type RuntimeFormatVersion = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type ParsedRuntimeProject = {
    project: RuntimeProject;
    formatVersion: RuntimeFormatVersion;
};
export declare function parseRuntimeProject(buffer: ArrayBuffer, fallbackName: string): Promise<ParsedRuntimeProject>;
