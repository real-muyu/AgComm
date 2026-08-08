import { ToolMessage } from "@langchain/core/messages";
import { renderTemplate } from "../../../../lib/flow-runtime/index.ts";
import { runWorkspaceToolCalling, type WorkspaceToolDefinition, type WorkspaceToolTrace } from "../../../../lib/workspace-tool-calling.ts";
import type { Skill } from "../../../../domain/flow/types.ts";
import { safeText, type PluginManager } from "./PluginManager.ts";
import type { ModelInvocationContext, RuntimeEvent } from "../runtime-types.ts";

type CallProvider = (messages: unknown[], tools: WorkspaceToolDefinition[], forceFinal: boolean, signal: AbortSignal, invocation: Omit<ModelInvocationContext, "callId" | "forceFinal">) => Promise<{ content: string }>;
export function createSkillExecutor(input: { manager: PluginManager; callProvider: CallProvider; messagesFor(system: string, text: string, topLevel: boolean): unknown[]; toolCalls: WorkspaceToolTrace[]; emit(event: RuntimeEvent): void }) {
  const { manager, callProvider, messagesFor, toolCalls, emit } = input;
  return async function runSkill(
        skill: Skill,
        input: unknown,
        runtimeVariables: Readonly<Record<string, unknown>>,
        signal: AbortSignal,
        node: { id: string },
        topLevel = true,
      ): Promise<string> {
        const text = safeText(input);
        const system = renderTemplate(skill.prompt || `You are the “${skill.name}” Skill.`, { ...runtimeVariables, skill_input: text });
        const messages: unknown[] = messagesFor(system, text, topLevel);
        const extraTools = await manager!.toolsFor(skill, signal);
        const invocation = {
          nodeId: node.id,
          nodeType: (topLevel ? "SKILL" : "WORKSPACE") as "SKILL" | "WORKSPACE",
          skillId: skill.id,
          purpose: (topLevel ? "skill" : "workspace-skill") as "skill" | "workspace-skill",
        };
        if (!extraTools.length) return (await callProvider(messages, [], true, signal, invocation)).content;
        const result = await runWorkspaceToolCalling({
          skills: [], extraTools, input: text, maxIterations: 6, maxToolCalls: 32, maxParallelToolCalls: 3, signal,
          initialMessages: messages,
          callAgent: (callHistory, tools, forceFinal) => callProvider(
            forceFinal ? [...callHistory, { role: "system", content: "Stop calling tools and provide the final answer." }] : callHistory,
            tools, forceFinal, signal, invocation,
          ),
          callSkill: async () => "",
          createToolMessage: (call, output) => new ToolMessage({ content: output, tool_call_id: call.id || crypto.randomUUID(), name: call.name }),
        });
        toolCalls.push(...result.toolCalls);
        for (const trace of result.toolCalls) emit({ type: "tool", trace });
        return result.output;
      };
}
