import { parseAiPackage } from "../../../../lib/ai-package.ts";
import { parseAiPackageV3, type AiProjectV3 } from "../../../../lib/ai-package-v3-format.ts";
import { parseAiPackageV4, type AiProjectV4 } from "../../../../lib/ai-package-v4-format.ts";
import { parseAiPackageV5, type AiProjectV5 } from "../../../../lib/ai-package-v5-format.ts";
import { parseAiPackageV6, type AiProjectV6 } from "../../../../lib/ai-package-v6-format.ts";
import { parseAiPackageV7, type AiProjectV7 } from "../../../../lib/ai-package-v7-format.ts";
import { parseAiPackageBeta1, type AiProjectBeta1 } from "../../../../lib/ai-package-beta-one-format.ts";
import { readZip } from "../../../../domain/package/zip.ts";
import type { FlowProject } from "../../../../domain/flow/types.ts";

export type RuntimeProject = FlowProject | AiProjectV3 | AiProjectV4 | AiProjectV5 | AiProjectV6 | AiProjectV7 | AiProjectBeta1;
export type RuntimeFormatVersion = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type ParsedRuntimeProject = { project: RuntimeProject; formatVersion: RuntimeFormatVersion };
type VersionedParser = (buffer: ArrayBuffer, fallbackName: string) => Promise<RuntimeProject>;

const VERSIONED_PARSERS = new Map<RuntimeFormatVersion, VersionedParser>([
  [3, parseAiPackageV3],
  [4, parseAiPackageV4],
  [5, parseAiPackageV5],
  [6, parseAiPackageV6],
  [7, parseAiPackageV7],
  [8, parseAiPackageBeta1],
]);

function isZip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function manifestVersion(text: string | undefined): unknown {
  if (!text) return 2;
  try {
    return (JSON.parse(text) as { formatVersion?: unknown } | null)?.formatVersion ?? 1;
  } catch {
    return 2;
  }
}

async function parseVersioned(buffer: ArrayBuffer, fallbackName: string, version: unknown): Promise<ParsedRuntimeProject | undefined> {
  if (typeof version !== "number") return undefined;
  const parser = VERSIONED_PARSERS.get(version as RuntimeFormatVersion);
  if (!parser) return undefined;
  return { project: await parser(buffer, fallbackName), formatVersion: version as RuntimeFormatVersion };
}

export async function parseRuntimeProject(buffer: ArrayBuffer, fallbackName: string): Promise<ParsedRuntimeProject> {
  if (!isZip(buffer)) return { project: await parseAiPackage(buffer, fallbackName), formatVersion: 0 };
  const version = manifestVersion((await readZip(buffer))["manifest.json"]);
  const versioned = await parseVersioned(buffer, fallbackName, version);
  if (versioned) return versioned;
  const legacyVersion = version === 1 ? 1 : 2;
  return { project: await parseAiPackage(buffer, fallbackName), formatVersion: legacyVersion };
}
