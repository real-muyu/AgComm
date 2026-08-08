import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export function arrayBufferOf(value: Uint8Array) { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer; }
export async function readRuntimePackageInput(pathOrBytes: string | Uint8Array | ArrayBuffer) {
  if (typeof pathOrBytes === "string") { const bytes = await readFile(pathOrBytes); return { buffer: arrayBufferOf(bytes), fallbackName: basename(pathOrBytes).replace(/\.ai$/i, "") }; }
  if (pathOrBytes instanceof Uint8Array) return { buffer: arrayBufferOf(pathOrBytes), fallbackName: "agent-project" };
  return { buffer: pathOrBytes, fallbackName: "agent-project" };
}
