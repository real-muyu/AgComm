import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
const outdir = resolve(root, "dist");
const staging = resolve(root, `.dist-${process.pid}-${randomUUID()}`);
const previous = `${staging}-previous`;
await mkdir(staging, { recursive: true });

try {
  await build({
    absWorkingDir: root,
    entryPoints: { index: "src/index.ts", cli: "src/cli-entry.ts", "gateway-host": "src/gateway-host.ts", "plugin-worker": "src/plugin-worker.ts" },
    outdir: staging,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    sourcemap: false,
    packages: "bundle",
    define: { __AI_RUNTIME_VERSION__: JSON.stringify(packageVersion) },
    external: [
      "@agcomm/gateway", "@agcomm/gateway/*",
      "@napi-rs/keyring", "@napi-rs/keyring-*",
      "@crosscopy/clipboard", "@crosscopy/clipboard-*",
      "node-screenshots", "node-screenshots-*",
    ],
    logLevel: "info",
  });
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  await promisify(execFile)(process.execPath, [tsc, "-p", resolve(root, "tsconfig.json"), "--outDir", staging], { cwd: root });
  await chmod(resolve(staging, "cli.js"), 0o755);
  await writeFile(resolve(staging, "index.d.ts"), 'export * from "./packages/ai-runtime/src/index.js";\n');
  await writeFile(resolve(staging, "gateway-host.d.ts"), 'export * from "./packages/ai-runtime/src/gateway-host.js";\n');
  try { await rename(outdir, previous); } catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await rename(staging, outdir); }
  catch (error) {
    try { await rename(previous, outdir); } catch { /* No previous build to restore. */ }
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
} finally {
  await rm(staging, { recursive: true, force: true });
  await rm(previous, { recursive: true, force: true });
}
