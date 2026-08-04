import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { unzipSync, zipSync } from "fflate";
import type { PluginValue } from "../../../runtime/plugins/sdk.ts";
import { AiRuntimeError } from "./errors.ts";
import type { PermissionAdapter } from "./plugin-sandbox.ts";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".json", ".docx"]);

export type RuntimePathRequest = {
  mode: "read" | "write";
  kind: "file" | "document";
  extensions?: readonly string[];
};

export type RuntimePathSelector = (request: RuntimePathRequest, signal: AbortSignal) => Promise<string | undefined>;

function object(value: PluginValue): Record<string, PluginValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, PluginValue> : {};
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function collectText(value: unknown, output: string[]) {
  if (typeof value === "string") { output.push(value); return; }
  if (Array.isArray(value)) { for (const item of value) collectText(item, output); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "w:t" || key.endsWith(":t")) collectText(item, output);
    else collectText(item, output);
    if (key === "w:p" || key.endsWith(":p")) output.push("\n");
  }
}

function readDocx(bytes: Uint8Array) {
  let files: ReturnType<typeof unzipSync>;
  try { files = unzipSync(bytes); }
  catch (error) { throw new AiRuntimeError("DOCUMENT_INVALID", "DOCX ZIP is invalid", { cause: error }); }
  const xml = files["word/document.xml"];
  if (!xml) throw new AiRuntimeError("DOCUMENT_INVALID", "DOCX is missing word/document.xml");
  try {
    const parsed = new XMLParser({ ignoreAttributes: false, preserveOrder: true }).parse(new TextDecoder("utf8", { fatal: true }).decode(xml));
    const output: string[] = [];
    collectText(parsed, output);
    return output.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch (error) { throw new AiRuntimeError("DOCUMENT_INVALID", "DOCX document XML is invalid", { cause: error }); }
}

function writeDocx(bytes: Uint8Array, text: string, operation: string) {
  let files: ReturnType<typeof unzipSync>;
  try { files = unzipSync(bytes); }
  catch (error) { throw new AiRuntimeError("DOCUMENT_INVALID", "DOCX ZIP is invalid", { cause: error }); }
  const document = files["word/document.xml"];
  if (!document) throw new AiRuntimeError("DOCUMENT_INVALID", "DOCX is missing word/document.xml");
  const xml = new TextDecoder("utf8", { fatal: true }).decode(document);
  new XMLParser({ ignoreAttributes: false }).parse(xml);
  const paragraph = `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const bodyStart = xml.indexOf("<w:body>");
  const bodyEnd = xml.lastIndexOf("</w:body>");
  if (bodyStart < 0 || bodyEnd < bodyStart) throw new AiRuntimeError("DOCUMENT_INVALID", "DOCX document body is missing");
  const next = operation === "append"
    ? `${xml.slice(0, bodyEnd)}${paragraph}${xml.slice(bodyEnd)}`
    : `${xml.slice(0, bodyStart + 8)}${paragraph}${xml.slice(bodyEnd)}`;
  files["word/document.xml"] = new TextEncoder().encode(next);
  return zipSync(files, { level: 6 });
}

async function atomicBytes(path: string, bytes: Uint8Array) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, path); }
  catch (error) { throw new AiRuntimeError("PERMISSION_WRITE_FAILED", `Unable to write selected file: ${basename(path)}`, { cause: error }); }
}

async function selectedPath(path: string, mode: "read" | "write") {
  const absolute = resolve(path);
  if (mode === "read") return realpath(absolute);
  try { return await realpath(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = await realpath(dirname(absolute));
    if (basename(absolute) === "." || basename(absolute) === "..") throw new AiRuntimeError("PERMISSION_PATH_INVALID", "Selected path is invalid");
    return join(parent, basename(absolute));
  }
}

export function createNativePermissionAdapter(options: { selectPath?: RuntimePathSelector } = {}): PermissionAdapter {
  const handles = new Map<string, string>();
  const choose = async (input: PluginValue, request: RuntimePathRequest, signal: AbortSignal) => {
    const values = object(input);
    const supplied = typeof values.handle === "string" ? values.handle : typeof values.documentId === "string" ? values.documentId : undefined;
    if (supplied) {
      const path = handles.get(supplied);
      if (!path) throw new AiRuntimeError("PERMISSION_HANDLE_INVALID", "The selected file handle has expired");
      return { token: supplied, path };
    }
    if (!options.selectPath) throw new AiRuntimeError("PERMISSION_INTERACTION_REQUIRED", "This permission requires an interactive file selection");
    const selected = await options.selectPath(request, signal);
    if (!selected) throw new AiRuntimeError("PERMISSION_CANCELLED", "File selection was cancelled");
    const path = await selectedPath(selected, request.mode);
    if (request.kind === "document" && !DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase())) throw new AiRuntimeError("DOCUMENT_TYPE_UNSUPPORTED", "Document must be TXT, Markdown, JSON, or DOCX");
    const token = randomUUID();
    handles.set(token, path);
    return { token, path };
  };

  return {
    "clipboard:read": async () => {
      try {
        const { getText } = await import("@crosscopy/clipboard");
        return { text: await getText() };
      }
      catch (error) { throw new AiRuntimeError("NATIVE_CLIPBOARD_UNAVAILABLE", "System clipboard is unavailable", { cause: error }); }
    },
    "clipboard:write": async (input) => {
      const text = object(input).text;
      if (typeof text !== "string") throw new AiRuntimeError("PERMISSION_INPUT_INVALID", "clipboard:write requires text");
      try {
        const { setText } = await import("@crosscopy/clipboard");
        await setText(text);
        return { written: true };
      }
      catch (error) { throw new AiRuntimeError("NATIVE_CLIPBOARD_UNAVAILABLE", "System clipboard is unavailable", { cause: error }); }
    },
    "screen:read": async () => {
      try {
        const { Monitor } = await import("node-screenshots");
        const monitor = Monitor.all().find((item) => item.isPrimary()) ?? Monitor.all()[0];
        if (!monitor) throw new Error("No monitor found");
        const png = await (await monitor.captureImage()).toPng();
        if (png.byteLength > MAX_FILE_BYTES) throw new AiRuntimeError("PERMISSION_OUTPUT_TOO_LARGE", "Screenshot exceeds 8 MiB");
        return { mimeType: "image/png", base64: png.toString("base64") };
      } catch (error) {
        if (error instanceof AiRuntimeError) throw error;
        throw new AiRuntimeError("NATIVE_SCREEN_UNAVAILABLE", "Screen capture is unavailable or not authorized by the operating system", { cause: error });
      }
    },
    "filesystem:read": async (input, signal) => {
      const selected = await choose(input, { mode: "read", kind: "file" }, signal);
      const metadata = await stat(selected.path);
      if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw new AiRuntimeError("PERMISSION_FILE_INVALID", "Selected file is invalid or exceeds 8 MiB");
      const bytes = await readFile(selected.path);
      return { handle: selected.token, name: basename(selected.path), base64: bytes.toString("base64") };
    },
    "filesystem:write": async (input, signal) => {
      const values = object(input);
      if (typeof values.base64 !== "string") throw new AiRuntimeError("PERMISSION_INPUT_INVALID", "filesystem:write requires base64");
      const bytes = Buffer.from(values.base64, "base64");
      if (bytes.byteLength > MAX_FILE_BYTES) throw new AiRuntimeError("PERMISSION_INPUT_TOO_LARGE", "File output exceeds 8 MiB");
      const selected = await choose(input, { mode: "write", kind: "file" }, signal);
      await atomicBytes(selected.path, bytes);
      return { handle: selected.token, written: true };
    },
    "document:read": async (input, signal) => {
      const selected = await choose(input, { mode: "read", kind: "document", extensions: [...DOCUMENT_EXTENSIONS] }, signal);
      const metadata = await stat(selected.path);
      if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw new AiRuntimeError("PERMISSION_FILE_INVALID", "Selected document is invalid or exceeds 8 MiB");
      const bytes = await readFile(selected.path);
      const docx = extname(selected.path).toLowerCase() === ".docx";
      const text = docx ? readDocx(bytes) : new TextDecoder("utf8", { fatal: true }).decode(bytes);
      return { documentId: selected.token, name: basename(selected.path), mimeType: docx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain", text };
    },
    "document:write": async (input, signal) => {
      const values = object(input);
      if (typeof values.text !== "string") throw new AiRuntimeError("PERMISSION_INPUT_INVALID", "document:write requires text");
      const operation = values.operation === "append" ? "append" : "replace";
      const selected = await choose(input, { mode: "write", kind: "document", extensions: [...DOCUMENT_EXTENSIONS] }, signal);
      let bytes: Uint8Array;
      if (extname(selected.path).toLowerCase() === ".docx") {
        const existing = await readFile(selected.path);
        bytes = writeDocx(existing, values.text, operation);
      } else {
        const current = operation === "append" ? await readFile(selected.path).catch((error) => (error as NodeJS.ErrnoException).code === "ENOENT" ? Buffer.alloc(0) : Promise.reject(error)) : Buffer.alloc(0);
        bytes = Buffer.concat([current, Buffer.from(values.text)]);
      }
      if (bytes.byteLength > MAX_FILE_BYTES) throw new AiRuntimeError("PERMISSION_INPUT_TOO_LARGE", "Document output exceeds 8 MiB");
      await atomicBytes(selected.path, bytes);
      return { documentId: selected.token, written: true };
    },
  };
}
