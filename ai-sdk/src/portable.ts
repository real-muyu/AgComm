import type { PluginTool } from "./plugin.ts";

export type BundleLimits = { timeoutMs?: number; maxOutputBytes?: number; maxConcurrency?: number };
export type BundleSchema = { inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PERMISSION_PATTERN = /^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$/;

export function validateBundleDefinition(
  definition: { entry: string; id: string; name: string; description: string; version: string; permissions?: readonly string[] },
  subject: string,
) {
  if (!ID_PATTERN.test(definition.id)) throw new Error(`Invalid ${subject} ID: ${definition.id}`);
  if (!definition.name.trim() || !definition.description.trim() || !definition.version.trim()) {
    throw new Error(`${subject} name, description, and version are required`);
  }
  let entry: URL;
  try { entry = new URL(definition.entry); }
  catch { throw new Error(`${subject} entry must be a file URL created with import.meta.url`); }
  if (entry.protocol !== "file:" && entry.href !== "agent-plugin:bundle") throw new Error(`${subject} entry must use the file: protocol`);
  const permissions = [...new Set(definition.permissions ?? [])];
  if (permissions.some((permission) => !PERMISSION_PATTERN.test(permission))) {
    throw new Error(`${subject} permissions contain an invalid permission name`);
  }
  return permissions;
}

export function createHandlerTools<TOperation extends string>(
  operations: readonly TOperation[],
  handlers: Partial<Record<TOperation, unknown>>,
  schemas: Readonly<Record<TOperation, BundleSchema>>,
  permissions: readonly string[],
  subject: string,
) {
  return Object.fromEntries(operations.map((operation) => [operation, {
    description: `${subject} ${operation}`,
    inputSchema: schemas[operation].inputSchema,
    outputSchema: schemas[operation].outputSchema,
    permissions: [...permissions],
    run: handlers[operation] as PluginTool["run"],
  }])) as Record<TOperation, PluginTool>;
}
