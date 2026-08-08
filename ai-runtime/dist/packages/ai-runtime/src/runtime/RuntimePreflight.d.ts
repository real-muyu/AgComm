import type { RuntimeProject } from "./ProjectExecutor.ts";
import type { ProviderConfig } from "./contracts/ModelPort.ts";
import type { RuntimeOptions } from "../runtime-types.ts";
export declare function createRuntimePreflight(options: RuntimeOptions, config: ProviderConfig, hasInjectedProvider: boolean): (project: RuntimeProject, packageHash: string) => Promise<void>;
