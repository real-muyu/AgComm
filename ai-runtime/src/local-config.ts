import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AiRuntimeError } from "./errors.ts";
import type { RuntimeTrustDecision, RuntimeTrustProvider, RuntimeTrustRequest } from "./runtime-types.ts";

const KEYRING_SERVICE = "io.agcomm.runtime.provider";

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

function defaultRoot() {
  return join(homedir(), ".agcomm", "runtime");
}

function validateId(value: string, subject: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new AiRuntimeError("CONFIG_INVALID", `${subject} is invalid`);
  return value;
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    try { await chmod(path, 0o600); } catch { /* Windows may ignore POSIX modes. */ }
  } catch (error) {
    await rm(temporary, { force: true });
    throw new AiRuntimeError("CONFIG_WRITE_FAILED", `Unable to write Runtime configuration: ${path}`, { cause: error });
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new AiRuntimeError("CONFIG_INVALID", `Runtime configuration is invalid: ${path}`, { cause: error });
  }
}

export function createSystemCredentialStore(): RuntimeCredentialStore {
  const entry = async (profileId: string) => {
    try {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      return new AsyncEntry(KEYRING_SERVICE, validateId(profileId, "Provider profile ID"));
    }
    catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "The operating-system credential store is unavailable", { cause: error }); }
  };
  return {
    async get(profileId, signal) {
      try { return await (await entry(profileId)).getPassword(signal); }
      catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to read the operating-system credential store", { cause: error }); }
    },
    async set(profileId, secret, signal) {
      if (secret.length < 8 || secret.length > 512) throw new AiRuntimeError("PROVIDER_SECRET_INVALID", "Provider API key length is invalid");
      try { await (await entry(profileId)).setPassword(secret, signal); }
      catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to write the operating-system credential store", { cause: error }); }
    },
    async delete(profileId, signal) {
      try { await (await entry(profileId)).deleteCredential(signal); }
      catch (error) { throw new AiRuntimeError("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to delete the operating-system credential", { cause: error }); }
    },
  };
}

export class LocalRuntimeConfigStore {
  readonly root: string;
  private readonly configPath: string;
  private readonly trustPath: string;

  constructor(options: { root?: string; credentialStore?: RuntimeCredentialStore } = {}) {
    this.root = resolve(options.root ?? defaultRoot());
    this.configPath = join(this.root, "config.json");
    this.trustPath = join(this.root, "trust.json");
    this.credentials = options.credentialStore ?? createSystemCredentialStore();
  }

  readonly credentials: RuntimeCredentialStore;

  async load(): Promise<RuntimeConfigDocument> {
    const value = await readJson<RuntimeConfigDocument>(this.configPath, { version: 1, providers: [], trustedKeys: {} });
    if (value.version !== 1 || !Array.isArray(value.providers) || !value.trustedKeys || typeof value.trustedKeys !== "object") {
      throw new AiRuntimeError("CONFIG_INVALID", "Runtime config.json has an unsupported structure");
    }
    return value;
  }

  async listProfiles() { return (await this.load()).providers.map((profile) => ({ ...profile })); }

  async selectedProfile() {
    const config = await this.load();
    return config.providers.find((profile) => profile.id === config.selectedProviderId) ?? config.providers[0];
  }

  async saveProfile(profile: ProviderProfile, secret?: string) {
    validateId(profile.id, "Provider profile ID");
    if (!profile.label.trim() || !profile.model.trim()) throw new AiRuntimeError("PROVIDER_PROFILE_INVALID", "Provider label and model are required");
    const url = new URL(profile.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new AiRuntimeError("PROVIDER_PROFILE_INVALID", "Provider Base URL must be credential-free HTTPS");
    if (secret !== undefined) await this.credentials.set(profile.id, secret);
    const config = await this.load();
    const normalized = { ...profile, label: profile.label.trim(), baseUrl: profile.baseUrl.replace(/\/$/, ""), model: profile.model.trim() };
    config.providers = [...config.providers.filter((item) => item.id !== profile.id), normalized];
    config.selectedProviderId = profile.id;
    await atomicJson(this.configPath, config);
  }

  async selectProfile(id: string) {
    const config = await this.load();
    if (!config.providers.some((profile) => profile.id === id)) throw new AiRuntimeError("PROVIDER_PROFILE_NOT_FOUND", `Provider profile was not found: ${id}`);
    config.selectedProviderId = id;
    await atomicJson(this.configPath, config);
  }

  async deleteProfile(id: string) {
    const config = await this.load();
    config.providers = config.providers.filter((profile) => profile.id !== id);
    if (config.selectedProviderId === id) config.selectedProviderId = config.providers[0]?.id;
    await this.credentials.delete(id);
    await atomicJson(this.configPath, config);
  }

  async trustedKeys() { return { ...(await this.load()).trustedKeys }; }

  async saveTrustedKey(keyId: string, publicKey: string) {
    if (!keyId.trim() || publicKey.trim().length < 40 || publicKey.trim().length > 256) throw new AiRuntimeError("TRUSTED_KEY_INVALID", "Trusted publisher key is invalid");
    const config = await this.load();
    config.trustedKeys[keyId.trim()] = publicKey.trim();
    await atomicJson(this.configPath, config);
  }

  async removeTrustedKey(keyId: string) {
    const config = await this.load();
    delete config.trustedKeys[keyId];
    await atomicJson(this.configPath, config);
  }

  async listTrustRecords() { return readJson<RuntimeTrustRecord[]>(this.trustPath, []); }

  async saveTrustRecord(record: RuntimeTrustRecord) {
    const records = await this.listTrustRecords();
    await atomicJson(this.trustPath, [...records.filter((item) => item.key !== record.key), record]);
  }

  async revokeTrustRecord(key: string) {
    await atomicJson(this.trustPath, (await this.listTrustRecords()).filter((item) => item.key !== key));
  }
}

function trustKey(request: RuntimeTrustRequest) {
  const permissions = [...request.permissions].sort().join("\0");
  return createHash("sha256").update(`${request.packageHash}\0${request.bundleId}\0${request.integrity}\0${permissions}`).digest("hex");
}

export function createPersistentTrustProvider(
  store: LocalRuntimeConfigStore,
  prompt: (request: RuntimeTrustRequest) => Promise<RuntimeTrustDecision>,
): RuntimeTrustProvider {
  return {
    async authorize(request) {
      const key = trustKey(request);
      const existing = (await store.listTrustRecords()).find((record) => record.key === key);
      if (existing) return { trusted: true, allowUnsigned: existing.unsignedAccepted, grants: existing.permissions };
      const decision = await prompt(request);
      if (!decision.trusted) return decision;
      const grants = [...new Set(decision.grants ?? [])].sort();
      if (grants.some((permission) => !request.permissions.includes(permission))) throw new AiRuntimeError("PLUGIN_GRANT_INVALID", `Trust decision contains an undeclared permission for ${request.bundleId}`);
      await store.saveTrustRecord({
        key, packageHash: request.packageHash, bundleId: request.bundleId, kind: request.kind,
        integrity: request.integrity, permissions: grants,
        unsignedAccepted: !request.signature && decision.allowUnsigned === true,
        grantedAt: new Date().toISOString(),
      });
      return { trusted: true, allowUnsigned: !request.signature && decision.allowUnsigned === true, grants };
    },
  };
}
