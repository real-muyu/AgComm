import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installActiveHandleDiagnostics } from "../../test-utils/active-handles.mjs";
import {
  createNativePermissionAdapter,
  createPersistentTrustProvider,
  LocalRuntimeConfigStore,
} from "../dist/index.js";

installActiveHandleDiagnostics("ai-runtime/local-host");

function memoryCredentials() {
  const values = new Map();
  return {
    values,
    async get(id) { return values.get(id); },
    async set(id, secret) { values.set(id, secret); },
    async delete(id) { values.delete(id); },
  };
}

test("stores provider metadata separately from OS credentials and persists package-bound trust", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-config-"));
  const credentials = memoryCredentials();
  const store = new LocalRuntimeConfigStore({ root, credentialStore: credentials });
  await store.saveProfile({ id: "default", label: "Default", baseUrl: "https://api.example.com/v1", model: "model" }, "secret-api-key");
  assert.equal((await store.selectedProfile()).id, "default");
  assert.equal(await credentials.get("default"), "secret-api-key");
  assert.doesNotMatch(await readFile(join(root, "config.json"), "utf8"), /secret-api-key/);

  let prompts = 0;
  const provider = createPersistentTrustProvider(store, async (request) => {
    prompts++;
    return { trusted: true, allowUnsigned: true, grants: request.permissions };
  });
  const request = {
    packageHash: "package-a", bundleId: "code-a", kind: "code", name: "Code", version: "1.0.0",
    integrity: "sha256-test", permissions: ["filesystem:read"],
  };
  assert.equal((await provider.authorize(request)).trusted, true);
  assert.equal((await provider.authorize(request)).trusted, true);
  assert.equal(prompts, 1);
  assert.equal((await store.listTrustRecords()).length, 1);
  await provider.authorize({ ...request, packageHash: "package-b" });
  assert.equal(prompts, 2);
});

test("native file and document adapters require selected canonical paths and use opaque handles", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-runtime-host-"));
  const inputPath = join(root, "input.txt");
  const outputPath = join(root, "output.bin");
  const documentPath = join(root, "document.md");
  await writeFile(inputPath, "hello");
  await writeFile(documentPath, "first");
  const selections = [inputPath, outputPath, documentPath];
  const adapter = createNativePermissionAdapter({ selectPath: async () => selections.shift() });
  const signal = new AbortController().signal;
  const read = await adapter["filesystem:read"]({}, signal);
  assert.equal(Buffer.from(read.base64, "base64").toString(), "hello");
  const reread = await adapter["filesystem:read"]({ handle: read.handle }, signal);
  assert.equal(reread.handle, read.handle);
  await adapter["filesystem:write"]({ base64: Buffer.from("written").toString("base64") }, signal);
  assert.equal(await readFile(outputPath, "utf8"), "written");
  await adapter["document:write"]({ text: " second", operation: "append" }, signal);
  assert.equal(await readFile(documentPath, "utf8"), "first second");

  const batch = createNativePermissionAdapter();
  await assert.rejects(() => batch["filesystem:read"]({}, signal), (error) => error.code === "PERMISSION_INTERACTION_REQUIRED");
});
