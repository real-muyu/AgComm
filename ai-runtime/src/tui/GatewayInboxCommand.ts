import type { Key } from "node:readline";

export type GatewayInboxCommand = "quit" | "previous" | "next" | "read" | "retry" | "none";

export function gatewayInboxCommand(text: string | undefined, key: Key): GatewayInboxCommand {
  const value = text?.toLowerCase();
  if (key.name === "escape" || value === "q") return "quit";
  if (key.name === "up") return "previous";
  if (key.name === "down") return "next";
  if (key.name === "return") return "read";
  if (value === "r") return "retry";
  return "none";
}
