import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { cleanDistConflicts } from "../../shared/clean-dist-conflicts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist");
const staging = resolve(root, `.dist-${process.pid}-${randomUUID()}`);
await mkdir(staging, { recursive: true });

try {
  await build({
    absWorkingDir: root,
    entryPoints: { index: "src/index.ts" },
    outdir: staging,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "bundle",
    external: ["@agcomm/ai-runtime", "@agcomm/ai-runtime/*", "@napi-rs/keyring", "@napi-rs/keyring-*"],
    legalComments: "none",
    sourcemap: false,
    logLevel: "info",
  });
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  await promisify(execFile)(process.execPath, [tsc, "-p", resolve(root, "tsconfig.json"), "--outDir", staging], { cwd: root });
  await cleanDistConflicts(staging);
  await rm(outdir, { recursive: true, force: true });
  await rename(staging, outdir);
} finally {
  await rm(staging, { recursive: true, force: true });
}
