// SPDX-License-Identifier: Elastic-2.0
import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";
import { readJson } from "./GatewayState.ts";

/** Process ownership lock with liveness-based stale-lock recovery. */
export class GatewayLock {
  private owner?: string;
  constructor(private readonly root: string, private readonly now: () => Date) {}
  async acquire() {
    const path = join(this.root, "gateway.lock");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const owner = `${process.pid}:${randomUUID()}`;
    const write = async () => { const handle = await open(path, "wx", 0o600); try { await handle.writeFile(`${JSON.stringify({ version: 1, owner, pid: process.pid, startedAt: this.now().toISOString() })}\n`); } finally { await handle.close(); } };
    try { await write(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new AiRuntimeError("GATEWAY_LOCK_FAILED", "Unable to acquire Runtime Gateway process lock", { cause: error });
      const lock = await readJson<{ startedAt?: string }>(path, {});
      const liveness = await readJson<{ at?: string }>(join(this.root, "liveness.json"), {});
      const latest = Math.max(Date.parse(lock.startedAt ?? ""), Date.parse(liveness.at ?? ""));
      if (Number.isFinite(latest) && this.now().getTime() - latest < 90_000) throw new AiRuntimeError("GATEWAY_ALREADY_RUNNING", "Another Runtime Gateway instance is active");
      await rm(path, { force: true });
      try { await write(); } catch (retryError) { throw new AiRuntimeError("GATEWAY_ALREADY_RUNNING", "Another Runtime Gateway instance acquired the process lock", { cause: retryError }); }
    }
    this.owner = owner;
  }
  async release() { if (!this.owner) return; const path = join(this.root, "gateway.lock"); try { if ((await readJson<{ owner?: string }>(path, {})).owner === this.owner) await rm(path, { force: true }); } finally { this.owner = undefined; } }
}
