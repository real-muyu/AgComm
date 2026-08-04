import type { RuntimeTrustDecision, RuntimeTrustProvider, RuntimeTrustRequest } from "./runtime-types.ts";
export type ProviderProfile = {
    id: string;
    label: string;
    baseUrl: string;
    model: string;
    embeddingModel?: string;
};
export type RuntimeTrustRecord = {
    key: string;
    packageHash: string;
    bundleId: string;
    kind: "plugin" | "code" | "hook" | "flow-hook";
    integrity: string;
    permissions: string[];
    unsignedAccepted: boolean;
    grantedAt: string;
};
type RuntimeConfigDocument = {
    version: 1;
    selectedProviderId?: string;
    providers: ProviderProfile[];
    trustedKeys: Record<string, string>;
};
export interface RuntimeCredentialStore {
    get(profileId: string, signal?: AbortSignal): Promise<string | undefined>;
    set(profileId: string, secret: string, signal?: AbortSignal): Promise<void>;
    delete(profileId: string, signal?: AbortSignal): Promise<void>;
}
export declare function createSystemCredentialStore(): RuntimeCredentialStore;
export declare class LocalRuntimeConfigStore {
    readonly root: string;
    private readonly configPath;
    private readonly trustPath;
    constructor(options?: {
        root?: string;
        credentialStore?: RuntimeCredentialStore;
    });
    readonly credentials: RuntimeCredentialStore;
    load(): Promise<RuntimeConfigDocument>;
    listProfiles(): Promise<{
        id: string;
        label: string;
        baseUrl: string;
        model: string;
        embeddingModel?: string;
    }[]>;
    selectedProfile(): Promise<ProviderProfile>;
    saveProfile(profile: ProviderProfile, secret?: string): Promise<void>;
    selectProfile(id: string): Promise<void>;
    deleteProfile(id: string): Promise<void>;
    trustedKeys(): Promise<{
        [x: string]: string;
    }>;
    saveTrustedKey(keyId: string, publicKey: string): Promise<void>;
    removeTrustedKey(keyId: string): Promise<void>;
    listTrustRecords(): Promise<RuntimeTrustRecord[]>;
    saveTrustRecord(record: RuntimeTrustRecord): Promise<void>;
    revokeTrustRecord(key: string): Promise<void>;
}
export declare function createPersistentTrustProvider(store: LocalRuntimeConfigStore, prompt: (request: RuntimeTrustRequest) => Promise<RuntimeTrustDecision>): RuntimeTrustProvider;
export {};
