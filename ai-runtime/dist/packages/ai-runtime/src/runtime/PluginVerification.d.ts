import type { Plugin } from "../../../../domain/flow/types.ts";
import type { RuntimeBundleKind, RuntimeTrustProvider } from "../runtime-types.ts";
export declare function verifyPlugin(plugin: Plugin, trustedKeys: Readonly<Record<string, string>>, allowUnsigned: boolean, packageHash: string, kind: RuntimeBundleKind, trustProvider?: RuntimeTrustProvider): Promise<{
    integrity: string;
    grants: readonly string[];
}>;
