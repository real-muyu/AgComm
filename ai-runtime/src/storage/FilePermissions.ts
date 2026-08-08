import { chmod } from "node:fs/promises";
import { AiRuntimeError } from "../errors.ts";

export async function enforcePrivateMode(path: string, mode: number, code: string): Promise<void> {
  await chmod(path, mode).catch((error) => {
    if (process.platform === "win32") return;
    throw new AiRuntimeError(code, `Unable to restrict local file permissions: ${path}`, { cause: error });
  });
}
