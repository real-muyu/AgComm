import { ToolMessage } from "@langchain/core/messages";
import { renderTemplate } from "../../../../lib/flow-runtime/index.ts";
import { runWorkspaceToolCalling, type WorkspaceToolCall, type WorkspaceToolDefinition, type WorkspaceToolTrace } from "../../../../lib/workspace-tool-calling.ts";
import type { Skill } from "../../../../domain/flow/types.ts";
import { safeText, type PluginManager } from "./PluginManager.ts";
import { WorkspaceHookPipeline, type HookTool } from "./WorkspaceHookPipeline.ts";
import type { ModelInvocationContext, RuntimeEvent } from "../runtime-types.ts";

type CallProvider = (messages: unknown[], tools: WorkspaceToolDefinition[], forceFinal: boolean, signal: AbortSignal, invocation: Omit<ModelInvocationContext, "callId" | "forceFinal">) => Promise<{ content: string; toolCalls?: WorkspaceToolCall[]; raw?: unknown }>;
type SkillRunner = (skill: Skill, input: unknown, variables: Readonly<Record<string, unknown>>, signal: AbortSignal, node: { id: string }, topLevel?: boolean) => Promise<string>;
export function createWorkspaceExecutor(input: { manager: PluginManager; callProvider: CallProvider; messagesFor(system: string, text: string, topLevel: boolean): unknown[]; runSkill: SkillRunner; toolCalls: WorkspaceToolTrace[]; emit(event: RuntimeEvent): void }) {
  const { manager, callProvider, messagesFor, runSkill, toolCalls, emit } = input;
  return async function runWorkspace(
        agent: Skill,
        skills: Skill[],
        input: unknown,
        maxIterations: number,
        runtimeVariables: Readonly<Record<string, unknown>>,
        signal: AbortSignal,
        node: { id: string; config?: Record<string, unknown> },
      ) {
        const hookIds = Array.isArray(node.config?.hookIds) ? node.config.hookIds.map(String) : [];
        const hooks = new WorkspaceHookPipeline(node.id, hookIds, runtimeVariables, manager!, signal, emit);
        const extraTools = await manager!.toolsFor(agent, signal);
        const skillTools = skills.map((skill, index) => ({
          modelName: `skill_${index + 1}_${skill.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || `skill_${index + 1}`}`.slice(0, 64),
          value: { id: skill.id, name: skill.name, kind: "skill" as const },
        }));
        const extraToolValues = extraTools.map((tool) => ({ modelName: tool.name, value: { id: tool.id, name: tool.label, kind: "plugin" as const } }));
        const resolveTool = (call: WorkspaceToolCall): HookTool => [...skillTools, ...extraToolValues].find((item) => item.modelName === call.name)?.value
          ?? { id: call.name, name: call.name, kind: "plugin" };
        let text = safeText(input);
        try {
          text = await hooks.start(text);
          const system = renderTemplate(agent.prompt || `You are the “${agent.name}” agent.`, hooks.variables);
          const messages: unknown[] = messagesFor(system, text, true);
          const result = await runWorkspaceToolCalling({
            skills, extraTools, input: text, maxIterations, maxToolCalls: 64, maxParallelToolCalls: 3, signal,
            initialMessages: messages,
            callAgent: async (callHistory, tools, forceFinal) => {
              if (!forceFinal) hooks.iteration++;
              const instructions = await hooks.beforeModel(text, callHistory, [...skillTools, ...extraToolValues].map((item) => item.value), forceFinal);
              const currentSystem = renderTemplate(agent.prompt || `You are the “${agent.name}” agent.`, hooks.variables);
              const preparedMessages = callHistory.map((message, index) => index === 0 ? { role: "system", content: currentSystem } : message);
              for (const instruction of instructions) preparedMessages.push({ role: "system", content: instruction });
              if (forceFinal) preparedMessages.push({ role: "system", content: "Stop calling tools and provide the final answer." });
              const reply = await callProvider(preparedMessages, tools, forceFinal, signal, {
                nodeId: node.id,
                nodeType: "WORKSPACE",
                skillId: agent.id,
                purpose: "workspace-agent",
                iteration: hooks.iteration,
              });
              return hooks.afterModel(reply, forceFinal, resolveTool);
            },
            callSkill: (skill, skillInput) => runSkill(skill, skillInput, hooks.variables, signal, node, false),
            beforeTool: (event) => hooks.beforeTool(event),
            afterTool: (event) => hooks.afterTool(event),
            createToolMessage: (call, output) => new ToolMessage({ content: output, tool_call_id: call.id || crypto.randomUUID(), name: call.name }),
          });
          toolCalls.push(...result.toolCalls);
          for (const trace of result.toolCalls) emit({ type: "tool", trace });
          return await hooks.finish(result.output);
        } catch (error) {
          await hooks.error(error);
          throw error;
        }
      };
}
