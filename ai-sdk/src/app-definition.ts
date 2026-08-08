import type { AppBackgroundConfig, AppInteractionConfig } from "../../../domain/flow/types.ts";
import { assertTimeZone, nextCronOccurrence, parseCronExpression } from "../../shared/background-schedule.ts";
import { FlowBuilder } from "./flow-builder.ts";
import { normalizeInteraction } from "./interaction.ts";
import { APP } from "./model-symbols.ts";
import type { AppBackgroundOptions, AppBuilderContext, AppDefinition, BackgroundValue, DefineAppOptions, InternalApp, PreparedApp, VariableRef } from "./model-types.ts";
import { AiSdkError } from "./model-types.ts";
import { assertId, fail, RESERVED_VARIABLES, variable } from "./model-values.ts";
import type { PortablePluginDefinition } from "./plugin.ts";

function uniqueById<T extends { id: string }>(values: readonly T[], subject: string) {
  const seen = new Set<string>();
  for (const value of values) { assertId(value.id, subject); if (seen.has(value.id)) fail(`DUPLICATE_${subject.toUpperCase()}`, `${subject} ID “${value.id}” 重复`, { path: value.id }); seen.add(value.id); }
}
function executionLimit(value: number, maximum: number, subject: string) { if (!Number.isInteger(value) || value < 1 || value > maximum) fail("INVALID_EXECUTION_LIMIT", `${subject} 必须为 1–${maximum} 的整数`); return value; }
function jsonClone(value: unknown, subject: string) {
  try { const encoded = JSON.stringify(value ?? {}); if (encoded.length > 65_536) fail("INVALID_BACKGROUND", `${subject} 超过 64 KiB`); return JSON.parse(encoded) as Record<string, BackgroundValue>; }
  catch (error) { if (error instanceof AiSdkError) throw error; fail("INVALID_BACKGROUND", `${subject} 必须是可序列化 JSON`); }
}

function normalizeBackground(value: AppBackgroundOptions | undefined, appId?: string, version?: string): AppBackgroundConfig | undefined {
  if (!value) return undefined;
  if (!appId) fail("BACKGROUND_APP_ID_REQUIRED", "后台应用必须声明稳定 id"); assertId(appId, "App");
  if (!version || version.length > 32 || !/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version)) fail("BACKGROUND_VERSION_REQUIRED", "后台应用必须声明有效 version");
  if (!value.heartbeat && !(value.cron?.length)) fail("BACKGROUND_TRIGGER_REQUIRED", "background 至少需要 heartbeat 或 cron 触发器");
  const historyWindow = value.historyWindow ?? 20; if (!Number.isInteger(historyWindow) || historyWindow < 1 || historyWindow > 100) fail("INVALID_BACKGROUND", "background.historyWindow 必须为 1–100");
  const ids = new Set<string>();
  const register = (id: string) => { assertId(id, "Background trigger"); if (ids.has(id)) fail("DUPLICATE_BACKGROUND_TRIGGER", `后台触发器 ID “${id}”重复`); ids.add(id); };
  const heartbeat = value.heartbeat ? (() => { const trigger = value.heartbeat!; register(trigger.id); if (!Number.isInteger(trigger.everyMs) || trigger.everyMs < 60_000 || trigger.everyMs > 86_400_000) fail("INVALID_HEARTBEAT", "heartbeat.everyMs 必须为 60000–86400000"); return { id: trigger.id, everyMs: trigger.everyMs, input: trigger.input, variables: jsonClone(trigger.variables, "heartbeat.variables"), runOnStart: trigger.runOnStart === true }; })() : undefined;
  if ((value.cron?.length ?? 0) > 64) fail("INVALID_CRON", "background.cron 最多包含 64 个触发器");
  const cron = (value.cron ?? []).map((trigger) => {
    register(trigger.id); try { parseCronExpression(trigger.expression); assertTimeZone(trigger.timezone); nextCronOccurrence(trigger.expression, trigger.timezone, new Date()); } catch (error) { fail("INVALID_CRON", `Cron“${trigger.id}”无效：${error instanceof Error ? error.message : String(error)}`); }
    const misfireGraceMs = trigger.misfireGraceMs ?? 900_000; if (!Number.isInteger(misfireGraceMs) || misfireGraceMs < 0 || misfireGraceMs > 86_400_000) fail("INVALID_CRON", `Cron“${trigger.id}”的 misfireGraceMs 必须为 0–86400000`);
    return { id: trigger.id, expression: trigger.expression.trim(), timezone: trigger.timezone, input: trigger.input, variables: jsonClone(trigger.variables, `cron.${trigger.id}.variables`), misfireGraceMs };
  });
  return { historyWindow, ...(heartbeat ? { heartbeat } : {}), ...(cron.length ? { cron } : {}) };
}

function validateBackgroundFlow(project: PreparedApp["project"], background: AppBackgroundConfig | undefined) {
  const contacts = project.nodes.filter((node) => node.type === "CONTACT");
  if (contacts.length && !background) fail("CONTACT_REQUIRES_BACKGROUND", "flow.contact() 要求 defineApp() 声明 background", { nodeId: contacts[0].id });
  if (!background) return;
  const definitions = new Map(project.variables.map((item) => [item.name, item]));
  const triggers = [...(background.heartbeat ? [background.heartbeat] : []), ...(background.cron ?? [])];
  for (const node of project.nodes.filter((item) => item.type === "INPUT")) {
    const fields = Array.isArray(node.config?.fields) ? node.config.fields as Array<Record<string, unknown>> : [];
    for (const trigger of triggers) for (const field of fields) {
      const name = String(field.variable ?? ""); const supplied = Object.hasOwn(trigger.variables ?? {}, name) || (name === "user_input" && trigger.input.length > 0); const definition = definitions.get(name); const hasDefault = definition !== undefined && (definition.type === "boolean" || definition.type === "number" || definition.defaultValue !== "");
      if (!supplied && !hasDefault) fail("BACKGROUND_INPUT_REQUIRED", `触发器“${trigger.id}”未提供 INPUT 变量“${name}”`, { nodeId: node.id });
    }
  }
}

function appExecution(options: DefineAppOptions) { return options.timeoutMs !== undefined || options.maxConcurrency !== undefined ? { ...(options.timeoutMs !== undefined ? { timeoutMs: executionLimit(options.timeoutMs, 600_000, "App timeoutMs") } : {}), ...(options.maxConcurrency !== undefined ? { maxConcurrency: executionLimit(options.maxConcurrency, 32, "App maxConcurrency") } : {}) } : undefined; }
function appSkills(options: DefineAppOptions) { const skills = [...(options.skills ?? [])]; uniqueById(skills, "skill"); return skills; }
function appFlowHooks(options: DefineAppOptions) { const hooks = [...(options.hooks ?? [])]; const ids = new Set<string>(); for (const hook of hooks) { assertId(hook.id, "Flow Hook"); if (ids.has(hook.id)) fail("DUPLICATE_FLOW_HOOK", `Flow Hook ID “${hook.id}”重复`, { path: hook.id }); ids.add(hook.id); } if (hooks.length > 16) fail("INVALID_FLOW_HOOKS", "App 最多声明 16 个 Flow Hook"); return hooks; }
function appPlugins(options: DefineAppOptions, skills: ReturnType<typeof appSkills>) { const values = new Map<string, PortablePluginDefinition>(); for (const plugin of [...(options.plugins ?? []), ...skills.flatMap((skill) => [...skill.plugins])]) { const current = values.get(plugin.id); if (current && current !== plugin) fail("DUPLICATE_PLUGIN", `Plugin ID “${plugin.id}”引用了不同定义`, { path: plugin.id }); values.set(plugin.id, plugin); } return [...values.values()]; }
function runtimeVariables(interaction: AppInteractionConfig | undefined, background: AppBackgroundConfig | undefined): VariableRef<unknown>[] { const values: VariableRef<unknown>[] = interaction ? [variable.string("session_id"), variable.array<Array<{ role: "user" | "assistant"; content: string }>>("conversation_history"), variable.markdown("knowledge_context")] : []; if (background) values.push(variable.object("background_trigger", { type: "manual" }), variable.string("gateway_run_id")); return values; }

export function defineApp(options: DefineAppOptions, build: (context: AppBuilderContext) => void): AppDefinition {
  if (!options.name.trim()) fail("INVALID_APP", "App 名称不能为空");
  const background = normalizeBackground(options.background, options.id, options.version);
  for (const ref of options.variables ?? []) if (RESERVED_VARIABLES.has(ref.name)) fail("RESERVED_VARIABLE", `变量“${ref.name}”由 runtime 保留，不能自行声明`, { path: ref.name });
  const interaction = normalizeInteraction(options.interaction);
  const execution = appExecution(options); const skills = appSkills(options); const flowHooks = appFlowHooks(options); const plugins = appPlugins(options, skills);
  const flow = new FlowBuilder([...(options.variables ?? []), ...runtimeVariables(interaction, background)], skills); const result = build({ flow }) as unknown;
  if (result && typeof (result as { then?: unknown }).then === "function") fail("ASYNC_BUILDER_UNSUPPORTED", "defineApp() 的流程 Builder 必须同步执行；异步工作应放在构建脚本调用 writeAi() 之前");
  const prepared: PreparedApp = { project: { ...flow.finish(options.name, skills, options.visualizations ?? [], interaction, { id: options.id, version: options.version, background }, execution), ...(flowHooks.length ? { flowHookIds: flowHooks.map((hook) => hook.id) } : {}) }, plugins, codes: flow.codes(), hooks: flow.hooks(), flowHooks };
  validateBackgroundFlow(prepared.project, background);
  return Object.freeze({ id: options.id, version: options.version, name: options.name, prepared, [APP]: true as const }) as InternalApp;
}

export function preparedApp(app: AppDefinition): PreparedApp {
  if (!app || typeof app !== "object" || !(APP in app)) fail("INVALID_APP", "需要由 defineApp() 创建的 AppDefinition");
  return (app as InternalApp).prepared;
}
