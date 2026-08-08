import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { FlowProject } from "../../../domain/flow/types.ts";
import { validateEditorFlow } from "../../../domain/flow/validator.ts";
import { createAiPackageBeta1, parseAiPackageBeta1, type AiProjectBeta1, type RuntimeBundleBeta1 } from "../../../lib/ai-package-beta-one-format.ts";
import { finalizePlugin } from "../../../runtime/plugins/package.ts";
import type { CodeDefinition } from "./code.ts";
import type { WorkspaceHookDefinition } from "./hook.ts";
import type { FlowHookDefinition } from "./flow-hook.ts";
import type { PortablePluginDefinition } from "./plugin.ts";
import { preparedApp } from "./app-definition.ts";
import { AiSdkError, type AiSdkIssue, type AppDefinition } from "./model-types.ts";

declare const __AI_SDK_VERSION__: string;
const SDK_VERSION = __AI_SDK_VERSION__;
const moduleUrl = new URL(import.meta.url);
const pluginRuntimePath = fileURLToPath(new URL(moduleUrl.pathname.endsWith(".ts") ? "./plugin.ts" : "./plugin.js", moduleUrl));
const codeRuntimePath = fileURLToPath(new URL(moduleUrl.pathname.endsWith(".ts") ? "./code.ts" : "./code.js", moduleUrl));
const hookRuntimePath = fileURLToPath(new URL(moduleUrl.pathname.endsWith(".ts") ? "./hook.ts" : "./hook.js", moduleUrl));
const flowHookRuntimePath = fileURLToPath(new URL(moduleUrl.pathname.endsWith(".ts") ? "./flow-hook.ts" : "./flow-hook.js", moduleUrl));
const RUNTIME_BUNDLE_ENTRY = "dist/index.js";

export type CompiledApp = {
  readonly formatVersion: 8;
  readonly project: AiProjectBeta1;
};

export type BuildResult = {
  readonly path: string;
  readonly byteLength: number;
  readonly compiled: CompiledApp;
};

function wrap(error: unknown, code: string, message: string): never {
  if (error instanceof AiSdkError) throw error;
  const value = error as { issues?: unknown; code?: unknown };
  const issues: AiSdkIssue[] = Array.isArray(value?.issues)
    ? value.issues.map((issue) => ({ code: String((issue as { code?: unknown }).code ?? code), message: String((issue as { message?: unknown }).message ?? message) }))
    : [];
  throw new AiSdkError(String(value?.code ?? code), error instanceof Error ? error.message : message, issues, { cause: error });
}

function entryPath(definition: { id: string; entry: string }, subject: "Plugin" | "Code" | "Hook") {
  let url: URL;
  try { url = new URL(definition.entry); }
  catch { throw new AiSdkError(`INVALID_${subject.toUpperCase()}_ENTRY`, `${subject} “${definition.id}”的 entry 必须是 import.meta.url 生成的 file URL`); }
  if (url.protocol !== "file:") throw new AiSdkError(`INVALID_${subject.toUpperCase()}_ENTRY`, `${subject} “${definition.id}”只支持 file: entry`);
  return fileURLToPath(url);
}

function runtimeBundlePackageJson(definition: { id: string; version: string }) {
  return JSON.stringify({
    name: definition.id.toLowerCase().replace(/_/g, "-"),
    version: definition.version,
    private: true,
    type: "module",
    dependencies: { "@agcomm/ai-sdk": `^${SDK_VERSION}` },
    scripts: { build: `esbuild src/index.ts --bundle --platform=browser --format=esm --target=es2022 --outfile=${RUNTIME_BUNDLE_ENTRY}` },
  }, null, 2);
}

const PLUGIN_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    noEmit: true,
    lib: ["ES2022", "WebWorker"],
  },
  include: ["src/**/*.ts"],
}, null, 2);

async function bundleEntry(
  entry: string,
  options: { importPattern: RegExp; runtimePath: string; pluginName: string; missingDefaultMessage: string },
) {
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: dirname(entry),
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
    plugins: [{
      name: options.pluginName,
      setup(api) {
        api.onResolve({ filter: options.importPattern }, () => ({ path: options.runtimePath }));
      },
    }],
  });
  const exports = Object.values(result.metafile.outputs).flatMap((output) => output.exports);
  if (!exports.includes("default")) throw new Error(options.missingDefaultMessage);
  const output = result.outputFiles.find((file) => file.path.endsWith(".js")) ?? result.outputFiles[0];
  if (!output) throw new Error("esbuild did not produce a JavaScript bundle");
  return output.text;
}

async function compilePlugin(definition: PortablePluginDefinition): Promise<RuntimeBundleBeta1> {
  const entry = entryPath(definition, "Plugin");
  let sourceCode: string;
  try { sourceCode = await readFile(entry, "utf8"); }
  catch (error) { throw new AiSdkError("PLUGIN_ENTRY_UNREADABLE", `无法读取 Plugin “${definition.id}”入口：${entry}`, [], { cause: error }); }
  if (!definition.tools || !Object.keys(definition.tools).length) throw new AiSdkError("INVALID_PLUGIN", `Plugin “${definition.id}”至少需要一个 Tool`);

  let bundleCode: string;
  try {
    bundleCode = await bundleEntry(entry, {
      importPattern: /^@agcomm\/(?:ai-sdk\/plugin|plugin-sdk)$/,
      runtimePath: pluginRuntimePath,
      pluginName: "agcomm-ai-sdk-plugin-runtime",
      missingDefaultMessage: "plugin entry must default-export definePlugin(...)",
    });
  } catch (error) {
    throw new AiSdkError("PLUGIN_BUILD_FAILED", `Plugin “${definition.id}”构建失败：${error instanceof Error ? error.message : String(error)}`, [], { cause: error });
  }

  const permissions = [...new Set(definition.permissions ?? [])];
  const tools = Object.entries(definition.tools).map(([name, tool]) => ({
    name,
    description: tool.description?.trim() ?? "",
    ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    permissions: [...new Set(tool.permissions ?? [])],
  }));
  for (const tool of tools) if (!tool.description) throw new AiSdkError("INVALID_PLUGIN_TOOL", `Plugin “${definition.id}”的 Tool “${tool.name}”缺少 description`);

  return { ...await finalizePlugin({
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "",
    version: definition.version,
    sdkVersion: "1",
    language: "typescript",
    entry: RUNTIME_BUNDLE_ENTRY,
    runtime: "runtime",
    source: "custom",
    ...(definition.author ? { author: definition.author } : {}),
    ...(definition.license ? { license: definition.license } : {}),
    ...(definition.homepage ? { homepage: definition.homepage } : {}),
    permissions,
    tools,
    ...(definition.limits ? { limits: definition.limits } : {}),
    packageJson: runtimeBundlePackageJson(definition),
    tsconfigJson: PLUGIN_TSCONFIG,
    sourceCode,
    bundleCode,
    readme: definition.readme ?? `# ${definition.name}\n\nPortable AgComm plugin built with @agcomm/ai-sdk.\n`,
  }), kind: "plugin" };
}

async function compileCode(definition: CodeDefinition): Promise<RuntimeBundleBeta1> {
  return compileRuntimeBundle(definition, {
    kind: "code",
    subject: "Code",
    entrySubject: "Code",
    runtimePath: codeRuntimePath,
    importPattern: /^@agcomm\/ai-sdk(?:\/code)?$/,
    pluginName: "agcomm-ai-sdk-code-runtime",
    missingDefaultMessage: "code entry must default-export defineCode(...)",
    tools: [{
      name: "run",
      description: definition.description,
      inputSchema: structuredClone(definition.inputSchema),
      outputSchema: structuredClone(definition.outputSchema),
      permissions: [...definition.permissions],
    }],
    readme: "Deterministic Code node",
  });
}

async function compileHook(definition: WorkspaceHookDefinition): Promise<RuntimeBundleBeta1> {
  return compileRuntimeBundle(definition, {
    kind: "workspace-hook",
    subject: "Workspace Hook",
    entrySubject: "Hook",
    runtimePath: hookRuntimePath,
    importPattern: /^@agcomm\/ai-sdk(?:\/hook)?$/,
    pluginName: "agcomm-ai-sdk-hook-runtime",
    missingDefaultMessage: "hook entry must default-export defineWorkspaceHook(...)",
    tools: hookTools(definition, "Workspace Hook"),
    readme: "Portable Workspace Hook",
  });
}

async function compileFlowHook(definition: FlowHookDefinition): Promise<RuntimeBundleBeta1> {
  return compileRuntimeBundle(definition, {
    kind: "flow-hook",
    subject: "Flow Hook",
    entrySubject: "Hook",
    runtimePath: flowHookRuntimePath,
    importPattern: /^@agcomm\/ai-sdk(?:\/flow-hook)?$/,
    pluginName: "agcomm-ai-sdk-flow-hook-runtime",
    missingDefaultMessage: "flow hook entry must default-export defineFlowHook(...)",
    tools: hookTools(definition, "Flow Hook"),
    readme: "Portable Flow Hook",
  });
}

type RuntimeDefinition = Pick<CodeDefinition, "entry" | "id" | "name" | "description" | "version" | "permissions" | "limits">;
type RuntimeCompileOptions = {
  kind: RuntimeBundleBeta1["kind"];
  subject: "Code" | "Workspace Hook" | "Flow Hook";
  entrySubject: "Code" | "Hook";
  runtimePath: string;
  importPattern: RegExp;
  pluginName: string;
  missingDefaultMessage: string;
  tools: RuntimeBundleBeta1["tools"];
  readme: string;
};

function hookTools(definition: WorkspaceHookDefinition | FlowHookDefinition, subject: string): RuntimeBundleBeta1["tools"] {
  return Object.entries(definition.tools).map(([name, tool]) => ({
    name,
    description: tool.description ?? `${subject} ${name}`,
    inputSchema: structuredClone(tool.inputSchema ?? { type: "object" }),
    outputSchema: structuredClone(tool.outputSchema ?? { type: ["object", "null"] }),
    permissions: [...new Set(tool.permissions ?? definition.permissions)],
  }));
}

async function compileRuntimeBundle(definition: RuntimeDefinition, options: RuntimeCompileOptions): Promise<RuntimeBundleBeta1> {
  const entry = entryPath(definition, options.entrySubject);
  let sourceCode: string;
  try { sourceCode = await readFile(entry, "utf8"); }
  catch (error) {
    const prefix = options.kind === "flow-hook" ? "FLOW_HOOK" : options.kind === "workspace-hook" ? "HOOK" : "CODE";
    throw new AiSdkError(`${prefix}_ENTRY_UNREADABLE`, `无法读取 ${options.subject} “${definition.id}”入口：${entry}`, [], { cause: error });
  }
  let bundleCode: string;
  try { bundleCode = await bundleEntry(entry, options); }
  catch (error) {
    const prefix = options.kind === "flow-hook" ? "FLOW_HOOK" : options.kind === "workspace-hook" ? "HOOK" : "CODE";
    throw new AiSdkError(`${prefix}_BUILD_FAILED`, `${options.subject} “${definition.id}”构建失败：${error instanceof Error ? error.message : String(error)}`, [], { cause: error });
  }
  return { ...await finalizePlugin({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: definition.version,
    sdkVersion: "1",
    language: "typescript",
    entry: RUNTIME_BUNDLE_ENTRY,
    runtime: "runtime",
    source: "custom",
    permissions: [...definition.permissions],
    tools: options.tools,
    ...(definition.limits ? { limits: { ...definition.limits } } : {}),
    packageJson: runtimeBundlePackageJson(definition),
    tsconfigJson: PLUGIN_TSCONFIG,
    sourceCode,
    bundleCode,
    readme: `# ${definition.name}\n\n${options.readme} built with @agcomm/ai-sdk.\n`,
  }), kind: options.kind };
}

export async function compileApp(app: AppDefinition): Promise<CompiledApp> {
  try {
    const prepared = preparedApp(app);
    const bundleDefinitions = [...prepared.plugins, ...prepared.codes, ...prepared.hooks, ...prepared.flowHooks];
    const bundleIds = new Set<string>();
    for (const definition of bundleDefinitions) {
      if (bundleIds.has(definition.id)) throw new AiSdkError("BUNDLE_ID_CONFLICT", `Plugin、Code 或 Hook ID “${definition.id}”冲突`);
      bundleIds.add(definition.id);
    }
    const nodeCollision = prepared.project.nodes.find((node) => bundleIds.has(node.id));
    if (nodeCollision) throw new AiSdkError("NODE_BUNDLE_ID_CONFLICT", `节点 ID “${nodeCollision.id}”与 bundle ID 冲突`);
    const [plugins, codes, hooks, flowHooks] = await Promise.all([
      Promise.all(prepared.plugins.map(compilePlugin)),
      Promise.all(prepared.codes.map(compileCode)),
      Promise.all(prepared.hooks.map(compileHook)),
      Promise.all(prepared.flowHooks.map(compileFlowHook)),
    ]);
    const project: AiProjectBeta1 = { ...structuredClone(prepared.project), formatVersion: 8, plugins: [...plugins, ...codes, ...hooks, ...flowHooks] };
    const validation = validateEditorFlow(project as unknown as FlowProject);
    if (!validation.valid) {
      const issues: AiSdkIssue[] = validation.issues.filter((issue) => issue.severity === "error").map((issue) => ({
        code: issue.code,
        message: issue.message,
        ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
      }));
      throw new AiSdkError("APP_INVALID", issues[0]?.message ?? "App 校验失败", issues);
    }
    return Object.freeze({ formatVersion: 8 as const, project });
  } catch (error) {
    wrap(error, "COMPILE_FAILED", "App 编译失败");
  }
}

async function packageApp(app: AppDefinition) {
  const compiled = await compileApp(app);
  try {
    const { formatVersion: _formatVersion, ...project } = compiled.project;
    const archive = createAiPackageBeta1(project);
    const buffer = await archive.arrayBuffer();
    await parseAiPackageBeta1(buffer, compiled.project.name);
    return { compiled, bytes: new Uint8Array(buffer) };
  } catch (error) {
    wrap(error, "PACKAGE_BUILD_FAILED", ".ai 构建或 round-trip 校验失败");
  }
}

export async function buildAi(app: AppDefinition): Promise<Uint8Array> {
  return (await packageApp(app)).bytes;
}

function outputPath(path: string | URL) {
  if (path instanceof URL && path.protocol !== "file:") throw new AiSdkError("INVALID_OUTPUT_PATH", "输出 URL 必须使用 file: 协议");
  const value = path instanceof URL ? fileURLToPath(path) : resolve(path);
  if (!/\.ai$/i.test(value)) throw new AiSdkError("INVALID_OUTPUT_PATH", "输出文件必须使用 .ai 扩展名");
  return value;
}

export async function writeAi(app: AppDefinition, path: string | URL): Promise<BuildResult> {
  const target = outputPath(path);
  const built = await packageApp(app);
  await mkdir(dirname(target), { recursive: true });
  const temporary = resolve(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, built.bytes);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new AiSdkError("WRITE_FAILED", `无法写入 ${target}`, [], { cause: error });
  }
  return { path: target, byteLength: built.bytes.byteLength, compiled: built.compiled };
}

export function fileUrl(path: string) {
  return pathToFileURL(resolve(path));
}
