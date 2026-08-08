import { open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { AiRuntimeError } from "../errors.ts";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;
const LOCK_ATTEMPTS = 100;

async function removeStaleLock(path: string) {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs <= LOCK_STALE_MS) return false;
    await rm(path, { force: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function acquire(path: string) {
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
    return handle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return undefined;
  }
}

export async function withLocalFileLock<T>(directory: string, task: () => Promise<T>): Promise<T> {
  const path = join(directory, ".lock");
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    const handle = await acquire(path);
    if (handle) {
      try { return await task(); }
      finally { await handle.close(); await rm(path, { force: true }); }
    }
    if (!await removeStaleLock(path)) await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
  throw new AiRuntimeError("LOCAL_DATA_LOCKED", "Local runtime data is locked by another process");
}
