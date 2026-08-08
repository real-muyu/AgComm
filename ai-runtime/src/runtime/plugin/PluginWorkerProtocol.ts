import type { PluginValue } from "../../../../../runtime/plugins/sdk.ts";

export type WorkerReply =
  | { type: "ready" }
  | { type: "init-error"; error: string }
  | { type: "result"; id: string; result?: PluginValue; error?: string }
  | { type: "permission"; id: string; runId: string; permission: string; input: PluginValue }
  | { type: "log"; runId: string; level: string; message: string; details?: PluginValue };

export type PermissionReply = Extract<WorkerReply, { type: "permission" }>;
export type ResultReply = Extract<WorkerReply, { type: "result" }>;
