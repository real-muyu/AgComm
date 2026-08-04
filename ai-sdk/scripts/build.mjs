import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
const outdir = resolve(root, "dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const portableEntries = ["plugin", "code", "hook", "flow-hook"];

await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
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
    outfile: `dist/${entry}.js`,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
  })),
]);
