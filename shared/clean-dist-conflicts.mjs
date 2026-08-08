import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONFLICT_SUFFIX = / \d+(?=\.|$)/;

export async function cleanDistConflicts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (CONFLICT_SUFFIX.test(entry.name)) {
      await rm(path, { recursive: entry.isDirectory(), force: true });
    } else if (entry.isDirectory()) {
      await cleanDistConflicts(path);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: clean-dist-conflicts.mjs <directory>");
  await cleanDistConflicts(resolve(directory));
}
