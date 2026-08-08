import { LocalAppStore } from "../app-storage.ts";
import type { RuntimeOptions } from "../runtime-types.ts";
export declare function loadRuntimeApp(pathOrBytes: string | Uint8Array | ArrayBuffer, options: RuntimeOptions): Promise<{
    parsed: import("./PackageParser.ts").ParsedRuntimeProject;
    project: import("./PackageParser.ts").RuntimeProject;
    store: LocalAppStore;
    persistentHistory: boolean;
}>;
