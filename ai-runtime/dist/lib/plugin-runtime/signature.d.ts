import type { SignedPluginManifest } from "./types.ts";
export declare function pluginSignaturePayload(manifest: SignedPluginManifest): Uint8Array<ArrayBuffer>;
export declare function verifyPluginSignature(manifest: SignedPluginManifest, trustedKeys: Readonly<Record<string, string>>): Promise<boolean>;
export declare function parseIntegrity(value: string): string | null;
export declare function verifyBundleIntegrity(bundle: string, integrity: string): Promise<boolean>;
export declare function computeBundleIntegrity(bundle: string): Promise<string>;
