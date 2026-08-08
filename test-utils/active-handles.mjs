import assert from "node:assert/strict";
import { after } from "node:test";

const ignored = new Set([process.stdin, process.stdout, process.stderr]);

function activeHandles() {
  const inspect = process._getActiveHandles;
  return typeof inspect === "function"
    ? inspect.call(process).filter((handle) => !ignored.has(handle))
    : [];
}

function describe(handle) {
  const name = handle?.constructor?.name ?? typeof handle;
  const address = typeof handle?.address === "function" ? handle.address() : undefined;
  const pid = typeof handle?.pid === "number" ? ` pid=${handle.pid}` : "";
  const endpoint = address && typeof address === "object"
    ? ` ${address.address ?? ""}:${address.port ?? address.path ?? ""}`
    : "";
  return `${name}${pid}${endpoint}`;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 25));
}

export function installActiveHandleDiagnostics(label) {
  const baseline = new Set(activeHandles());
  const baselineResources = resourceCounts();
  after(async () => {
    await settle();
    const leaked = activeHandles().filter((handle) => !baseline.has(handle));
    assert.deepEqual(leaked.map(describe), [], `${label} left active handles after test cleanup`);
    const currentResources = resourceCounts();
    const growth = [...currentResources]
      .filter(([type, count]) => count > (baselineResources.get(type) ?? 0))
      .map(([type, count]) => `${type} +${count - (baselineResources.get(type) ?? 0)}`);
    assert.deepEqual(growth, [], `${label} left active resources after test cleanup`);
  });
}

function resourceCounts() {
  const counts = new Map();
  for (const type of process.getActiveResourcesInfo?.() ?? []) counts.set(type, (counts.get(type) ?? 0) + 1);
  return counts;
}

export function childProcessTracker() {
  const children = new Set();
  return {
    add(child) {
      children.add(child);
      child.once("close", () => children.delete(child));
      return child;
    },
    async dispose() {
      const closing = [...children].map(async (child) => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise((resolve) => child.once("close", resolve));
        }
      });
      await Promise.allSettled(closing);
      children.clear();
    },
  };
}
