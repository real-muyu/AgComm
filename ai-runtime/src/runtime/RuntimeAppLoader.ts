import { LocalAppStore } from "../app-storage.ts";
import type { RuntimeOptions } from "../runtime-types.ts";
import { readRuntimePackageInput } from "./RuntimeApp.ts";
import { parseRuntimeProject } from "./PackageParser.ts";

export async function loadRuntimeApp(pathOrBytes: string | Uint8Array | ArrayBuffer, options: RuntimeOptions) {
  const source = await readRuntimePackageInput(pathOrBytes);
  const parsed = await parseRuntimeProject(source.buffer, source.fallbackName);
  const store = new LocalAppStore(new Uint8Array(source.buffer), { dataDir: options.dataDir, parsers: options.knowledgeParsers });
  const persistentHistory = parsed.project.interaction?.conversation?.history === true;
  if (persistentHistory || parsed.project.interaction?.knowledge) await store.initialize();
  return { parsed, project: parsed.project, store, persistentHistory };
}
