// SPDX-License-Identifier: Elastic-2.0
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";
import { enforceGatewayPrivateMode } from "../gateway/GatewayFilePermissions.ts";

export function defaultGatewayRoot(): string {
  return join(homedir(), ".agcomm", "runtime", "gateway");
}

export function gatewayIpcEndpoint(root: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\agcomm-${createHash("sha256").update(root).digest("hex").slice(0, 20)}`
    : join(root, "gateway.sock");
}

export async function gatewayIpcToken(root: string, create: boolean): Promise<string> {
  const path = join(root, "ipc-token");
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new AiRuntimeError("GATEWAY_UNAVAILABLE", "Runtime Gateway IPC credentials are unavailable", { cause: error });
    }
    const value = randomBytes(32).toString("base64url");
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(path, value, { encoding: "utf8", mode: 0o600 });
    await enforceGatewayPrivateMode(path, 0o600);
    return value;
  }
}
