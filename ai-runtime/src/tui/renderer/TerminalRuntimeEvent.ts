import type { FlowEvent } from "../../../../../lib/flow-runtime/index.ts";
import type { RuntimeEvent } from "../../runtime-types.ts";
import { sanitizeTerminalText } from "./TerminalText.ts";

export type TerminalRuntimeUpdate = { phase?: string; activity?: string };

function flowUpdate(event: FlowEvent): TerminalRuntimeUpdate {
  let phase: string | undefined;
  if (event.type === "node:start") phase = `正在执行节点 ${event.nodeId}`;
  if (event.type === "node:retry") phase = `正在重试节点 ${event.nodeId}`;
  if (event.type === "flow:pause") phase = `流程已暂停 · ${event.nodeId}`;
  if (event.type === "flow:complete") phase = "流程已完成";
  const activity = event.type.startsWith("node:")
    ? `${event.type.replace("node:", "")} · ${"nodeId" in event ? event.nodeId : ""}`
    : undefined;
  return { phase, activity };
}

export function terminalRuntimeEvent(event: RuntimeEvent): TerminalRuntimeUpdate {
  if (event.type === "flow") return flowUpdate(event.event);
  if (event.type === "tool") return { activity: `tool · ${event.trace.skillName} · ${event.trace.kind}` };
  if (event.type === "hook") return { activity: `hook · ${event.hookId}.${event.stage} · ${event.status}` };
  if (event.type === "flow-hook") {
    return { activity: `flow-hook · ${event.hookId}.${event.stage} · ${event.nodeId} · ${event.status}` };
  }
  return { activity: `log · ${event.log.pluginId} · ${event.log.level} · ${event.log.message}` };
}

export function sanitizeRuntimeUpdate(update: TerminalRuntimeUpdate): TerminalRuntimeUpdate {
  return {
    ...(update.phase ? { phase: sanitizeTerminalText(update.phase, false) } : {}),
    ...(update.activity ? { activity: sanitizeTerminalText(update.activity, false) } : {}),
  };
}
