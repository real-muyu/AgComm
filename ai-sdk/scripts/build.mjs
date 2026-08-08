import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { cleanDistConflicts } from "../../shared/clean-dist-conflicts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
const outdir = resolve(root, "dist");
const staging = resolve(root, `.dist-${process.pid}-${randomUUID()}`);
const portableEntries = ["plugin", "code", "hook", "flow-hook"];
await mkdir(staging, { recursive: true });

try {
  await Promise.all([
    build({
      absWorkingDir: root,
      entryPoints: ["src/index.ts"],
      outfile: resolve(staging, "index.js"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "bundle",
      define: { __AI_SDK_VERSION__: JSON.stringify(packageVersion) },
      external: ["@agcomm/ai-runtime", "@agcomm/gateway", "esbuild"],
      sourcemap: false,
      legalComments: "none",
    }),
    ...portableEntries.map((entry) => build({
      absWorkingDir: root,
      entryPoints: [`src/${entry}.ts`],
      outfile: resolve(staging, `${entry}.js`),
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      sourcemap: false,
      legalComments: "none",
    })),
  ]);
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  await promisify(execFile)(process.execPath, [tsc, "-p", resolve(root, "tsconfig.json"), "--outDir", staging], { cwd: root });
  await cleanDistConflicts(staging);
  await rm(outdir, { recursive: true, force: true });
  await rename(staging, outdir);
} finally {
  await rm(staging, { recursive: true, force: true });
}
