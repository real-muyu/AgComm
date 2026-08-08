import type { Key } from "node:readline";
export type GatewayInboxCommand = "quit" | "previous" | "next" | "read" | "retry" | "none";
export declare function gatewayInboxCommand(text: string | undefined, key: Key): GatewayInboxCommand;
