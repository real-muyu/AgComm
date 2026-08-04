// SPDX-License-Identifier: Elastic-2.0
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection, createServer } from "node:net";
import { AiRuntimeError, type AiStreamMode } from "@agcomm/ai-runtime/gateway-host";
import type {
  GatewayAppSummary,
  GatewayInboxItem,
  GatewayInstallOptions,
  GatewayRunRecord,
  GatewayRunStream,
  GatewayStartRunOptions,
  GatewayRunTicket,
  GatewayStreamFrame,
  RuntimeGateway,
} from "./gateway.ts";

type Request = { token: string; operation: string; args?: unknown[] };
type Response = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
type StreamResponse =
  | Response
  | { stream: true; frame: GatewayStreamFrame }
  | { done: true; record: GatewayRunRecord };

function defaultRoot() { return join(homedir(), ".agcomm", "runtime", "gateway"); }
function endpoint(root: string) {
  return process.platform === "win32" ? `\\\\.\\pipe\\agcomm-${createHash("sha256").update(root).digest("hex").slice(0, 20)}` : join(root, "gateway.sock");
}
async function token(root: string, create: boolean) {
  const path = join(root, "ipc-token");
  try { return (await readFile(path, "utf8")).trim(); }
  catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw new AiRuntimeError("GATEWAY_UNAVAILABLE", "Runtime Gateway IPC credentials are unavailable", { cause: error });
    const value = randomBytes(32).toString("base64url");
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(path, value, { encoding: "utf8", mode: 0o600 });
    try { await chmod(path, 0o600); } catch { /* Platform may ignore modes. */ }
    return value;
  }
}

function failure(error: unknown): Response {
  return { ok: false, error: { code: error instanceof AiRuntimeError ? error.code : "GATEWAY_REQUEST_FAILED", message: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) } };
}

async function dispatch(gateway: RuntimeGateway, request: Request) {
  const args = request.args ?? [];
  if (request.operation === "ping") return gateway.status();
  if (request.operation === "listApps") return gateway.listApps();
  if (request.operation === "install") return gateway.install(String(args[0]), (args[1] ?? {}) as GatewayInstallOptions);
  if (request.operation === "enable") return gateway.enable(String(args[0]));
  if (request.operation === "disable") return gateway.disable(String(args[0]));
  if (request.operation === "uninstall") return gateway.uninstall(String(args[0]));
  if (request.operation === "runNow") return gateway.runNow(String(args[0]), String(args[1]));
  if (request.operation === "startRunNow") {
    return gateway.startRunNow(String(args[0]), String(args[1]), (args[2] ?? {}) as GatewayStartRunOptions);
  }
  if (request.operation === "listRuns") return gateway.listRuns(String(args[0]));
  if (request.operation === "listInbox") return gateway.listInbox(String(args[0]));
  if (request.operation === "markInboxRead") return gateway.markInboxRead(String(args[0]), Array.isArray(args[1]) ? args[1].map(String) : []);
  if (request.operation === "retryDelivery") return gateway.retryDelivery(String(args[0]), String(args[1]));
  throw new AiRuntimeError("GATEWAY_OPERATION_INVALID", `Unknown Gateway operation: ${request.operation}`);
}

export async function createGatewayIpcServer(gateway: RuntimeGateway, root: string) {
  const secret = await token(root, true);
  const path = endpoint(root);
  if (process.platform !== "win32") await rm(path, { force: true });
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1_048_576) { socket.destroy(); return; }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      void (async () => {
        try {
          const request = JSON.parse(line) as Request;
          if (request.token !== secret) throw new AiRuntimeError("GATEWAY_AUTH_FAILED", "Gateway IPC authentication failed");
          if (request.operation === "watchRun") {
            const args = request.args ?? [];
            const controller = new AbortController();
            socket.once("close", () => controller.abort(new DOMException("Gateway subscription closed", "AbortError")));
            const stream = await gateway.watchRun(String(args[0]), String(args[1]), {
              ...((args[2] ?? {}) as { mode?: AiStreamMode; afterSequence?: number }),
              signal: controller.signal,
            });
            socket.write(`${JSON.stringify({ ok: true, value: { runId: stream.runId, mode: stream.mode } })}\n`);
            for await (const frame of stream) {
              if (!socket.write(`${JSON.stringify({ stream: true, frame })}\n`)) {
                await new Promise<void>((resolveDrain, reject) => {
                  socket.once("drain", resolveDrain);
                  socket.once("error", reject);
                });
              }
            }
            const record = await stream.completion;
            socket.end(`${JSON.stringify({ done: true, record })}\n`);
            return;
          }
          socket.end(`${JSON.stringify({ ok: true, value: await dispatch(gateway, request) })}\n`);
        } catch (error) {
          if (!socket.destroyed) socket.end(`${JSON.stringify(failure(error))}\n`);
        }
      })();
    });
  });
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(path, () => { server.off("error", reject); resolveListen(); }); });
  if (process.platform !== "win32") try { await chmod(path, 0o600); } catch { await new Promise<void>((resolveClose) => server.close(() => resolveClose())); throw new AiRuntimeError("GATEWAY_IPC_PERMISSIONS", "Unable to restrict Gateway IPC socket permissions"); }
  return {
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      if (process.platform !== "win32") await rm(path, { force: true });
    },
  };
}

export interface RuntimeGatewayClient {
  ping(): Promise<{ alive: true; pid: number; heartbeatAt?: string; healthy: boolean }>;
  listApps(): Promise<GatewayAppSummary[]>;
  install(path: string, options?: GatewayInstallOptions): Promise<GatewayAppSummary>;
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  runNow(id: string, triggerId: string): Promise<void>;
  startRunNow(id: string, triggerId: string, options?: GatewayStartRunOptions): Promise<GatewayRunTicket>;
  watchRun(
    id: string,
    runId: string,
    options?: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal },
  ): Promise<GatewayRunStream>;
  listRuns(id: string): Promise<GatewayRunRecord[]>;
  listInbox(id: string): Promise<GatewayInboxItem[]>;
  markInboxRead(id: string, notificationIds: readonly string[]): Promise<void>;
  retryDelivery(id: string, notificationId: string): Promise<void>;
}

export async function connectRuntimeGateway(options: { root?: string } = {}): Promise<RuntimeGatewayClient> {
  const root = resolve(options.root ?? defaultRoot());
  const secret = await token(root, false);
  const call = <T>(operation: string, args: unknown[] = []) => new Promise<T>((resolveCall, reject) => {
    const socket = createConnection(endpoint(root));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.once("error", (error) => reject(new AiRuntimeError("GATEWAY_UNAVAILABLE", "Runtime Gateway is not running", { cause: error })));
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: secret, operation, args })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as Response;
        if (!response.ok) reject(new AiRuntimeError(response.error.code, response.error.message));
        else resolveCall(response.value as T);
      } catch (error) { reject(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned an invalid response", { cause: error })); }
    });
  });
  const watchRun = (
    id: string,
    runId: string,
    watch: { mode?: AiStreamMode; afterSequence?: number; signal?: AbortSignal } = {},
  ) => new Promise<GatewayRunStream>((resolveStream, rejectStream) => {
    if (watch.signal?.aborted) {
      rejectStream(watch.signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const socket = createConnection(endpoint(root));
    socket.setEncoding("utf8");
    let buffer = "";
    let acknowledged = false;
    let consumed = false;
    let closed = false;
    let cursor = Math.max(0, Math.floor(watch.afterSequence ?? 0));
    const queue: GatewayStreamFrame[] = [];
    let wake: (() => void) | undefined;
    let terminalError: unknown;
    let resolveCompletion!: (record: GatewayRunRecord) => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<GatewayRunRecord>((resolveRun, rejectRun) => {
      resolveCompletion = resolveRun;
      rejectCompletion = rejectRun;
    });
    void completion.catch(() => { /* The iterator or caller observes the connection failure. */ });
    let stream!: GatewayRunStream;
    const notify = () => {
      const current = wake;
      wake = undefined;
      current?.();
    };
    const fail = (error: unknown) => {
      if (closed) return;
      closed = true;
      terminalError = error instanceof AiRuntimeError || error instanceof DOMException
        ? error
        : new AiRuntimeError("GATEWAY_UNAVAILABLE", "Gateway stream connection failed", { cause: error });
      rejectCompletion(terminalError);
      notify();
      if (!acknowledged) rejectStream(terminalError);
    };
    const abort = () => {
      const reason = watch.signal?.reason ?? new DOMException("Aborted", "AbortError");
      fail(reason);
      socket.destroy();
    };
    watch.signal?.addEventListener("abort", abort, { once: true });
    socket.once("error", fail);
    socket.once("close", () => {
      watch.signal?.removeEventListener("abort", abort);
      if (!closed) fail(new AiRuntimeError("GATEWAY_STREAM_CLOSED", "Gateway stream closed before completion"));
    });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({
        token: secret,
        operation: "watchRun",
        args: [id, runId, { mode: watch.mode, afterSequence: watch.afterSequence }],
      })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 5 * 1_048_576) {
        fail(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Gateway stream frame exceeds the IPC limit"));
        socket.destroy();
        return;
      }
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let response: StreamResponse;
        try { response = JSON.parse(line) as StreamResponse; }
        catch (error) {
          fail(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned an invalid stream response", { cause: error }));
          socket.destroy();
          return;
        }
        if ("ok" in response) {
          if (!response.ok) {
            fail(new AiRuntimeError(response.error.code, response.error.message));
            socket.destroy();
            return;
          }
          if (acknowledged) {
            fail(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned duplicate stream acknowledgement"));
            socket.destroy();
            return;
          }
          const value = response.value as { runId: string; mode: AiStreamMode };
          acknowledged = true;
          stream = {
            runId: value.runId,
            mode: value.mode,
            get lastSequence() { return cursor; },
            completion,
            async *[Symbol.asyncIterator]() {
              if (consumed) throw new AiRuntimeError("GATEWAY_STREAM_ALREADY_CONSUMED", "Gateway run stream only supports one consumer");
              consumed = true;
              try {
                for (;;) {
                  while (queue.length) {
                    const frame = queue.shift()!;
                    cursor = Math.max(cursor, frame.sequence);
                    yield frame;
                  }
                  if (closed) {
                    if (terminalError) throw terminalError;
                    return;
                  }
                  await new Promise<void>((resolveWake) => { wake = resolveWake; });
                }
              } finally {
                if (!closed) {
                  fail(new DOMException("Gateway stream consumer stopped", "AbortError"));
                  socket.destroy();
                }
              }
            },
          };
          resolveStream(stream);
          continue;
        }
        if ("stream" in response) {
          if (!acknowledged) {
            fail(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Gateway sent a stream frame before acknowledgement"));
            socket.destroy();
            return;
          }
          queue.push(response.frame);
          notify();
          continue;
        }
        if (!acknowledged) {
          fail(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Gateway completed a stream before acknowledgement"));
          socket.destroy();
          return;
        }
        closed = true;
        resolveCompletion(response.record);
        notify();
        socket.end();
      }
    });
  });
  return {
    ping: () => call("ping"), listApps: () => call("listApps"), install: (path, install) => call("install", [path, install]),
    enable: (id) => call("enable", [id]), disable: (id) => call("disable", [id]), uninstall: (id) => call("uninstall", [id]),
    runNow: (id, triggerId) => call("runNow", [id, triggerId]),
    startRunNow: (id, triggerId, start) => call("startRunNow", [id, triggerId, start]),
    watchRun,
    listRuns: (id) => call("listRuns", [id]), listInbox: (id) => call("listInbox", [id]),
    markInboxRead: (id, ids) => call("markInboxRead", [id, ids]), retryDelivery: (id, notificationId) => call("retryDelivery", [id, notificationId]),
  };
}
