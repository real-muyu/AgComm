// SPDX-License-Identifier: Elastic-2.0
import { chmod } from "node:fs/promises";
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";

export async function enforceGatewayPrivateMode(path: string, mode: number): Promise<void> {
  await chmod(path, mode).catch((error) => {
    if (process.platform === "win32") return;
    throw new AiRuntimeError("GATEWAY_WRITE_FAILED", `Unable to restrict Gateway file permissions: ${path}`, { cause: error });
  });
}
