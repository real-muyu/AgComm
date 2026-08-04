var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/gateway-ipc.ts
var gateway_ipc_exports = {};
__export(gateway_ipc_exports, {
  connectRuntimeGateway: () => connectRuntimeGateway,
  createGatewayIpcServer: () => createGatewayIpcServer
});
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection, createServer } from "node:net";
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";
function defaultRoot() {
  return join(homedir(), ".agcomm", "runtime", "gateway");
}
function endpoint(root) {
  return process.platform === "win32" ? `\\\\.\\pipe\\agcomm-${createHash("sha256").update(root).digest("hex").slice(0, 20)}` : join(root, "gateway.sock");
}
async function token(root, create) {
  const path = join(root, "ipc-token");
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (!create || error.code !== "ENOENT") throw new AiRuntimeError("GATEWAY_UNAVAILABLE", "Runtime Gateway IPC credentials are unavailable", { cause: error });
    const value = randomBytes(32).toString("base64url");
    await mkdir(root, { recursive: true, mode: 448 });
    await writeFile(path, value, { encoding: "utf8", mode: 384 });
    try {
      await chmod(path, 384);
    } catch {
    }
    return value;
  }
}
function failure(error) {
  return { ok: false, error: { code: error instanceof AiRuntimeError ? error.code : "GATEWAY_REQUEST_FAILED", message: (error instanceof Error ? error.message : String(error)).slice(0, 4096) } };
}
async function dispatch(gateway, request) {
  const args = request.args ?? [];
  if (request.operation === "ping") return gateway.status();
  if (request.operation === "listApps") return gateway.listApps();
  if (request.operation === "install") return gateway.install(String(args[0]), args[1] ?? {});
  if (request.operation === "enable") return gateway.enable(String(args[0]));
  if (request.operation === "disable") return gateway.disable(String(args[0]));
  if (request.operation === "uninstall") return gateway.uninstall(String(args[0]));
  if (request.operation === "runNow") return gateway.runNow(String(args[0]), String(args[1]));
  if (request.operation === "startRunNow") {
    return gateway.startRunNow(String(args[0]), String(args[1]), args[2] ?? {});
  }
  if (request.operation === "listRuns") return gateway.listRuns(String(args[0]));
  if (request.operation === "listInbox") return gateway.listInbox(String(args[0]));
  if (request.operation === "markInboxRead") return gateway.markInboxRead(String(args[0]), Array.isArray(args[1]) ? args[1].map(String) : []);
  if (request.operation === "retryDelivery") return gateway.retryDelivery(String(args[0]), String(args[1]));
  throw new AiRuntimeError("GATEWAY_OPERATION_INVALID", `Unknown Gateway operation: ${request.operation}`);
}
async function createGatewayIpcServer(gateway, root) {
  const secret = await token(root, true);
  const path = endpoint(root);
  if (process.platform !== "win32") await rm(path, { force: true });
  const sockets = /* @__PURE__ */ new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1048576) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      void (async () => {
        try {
          const request = JSON.parse(line);
          if (request.token !== secret) throw new AiRuntimeError("GATEWAY_AUTH_FAILED", "Gateway IPC authentication failed");
          if (request.operation === "watchRun") {
            const args = request.args ?? [];
            const controller = new AbortController();
            socket.once("close", () => controller.abort(new DOMException("Gateway subscription closed", "AbortError")));
            const stream = await gateway.watchRun(String(args[0]), String(args[1]), {
              ...args[2] ?? {},
              signal: controller.signal
            });
            socket.write(`${JSON.stringify({ ok: true, value: { runId: stream.runId, mode: stream.mode } })}
`);
            for await (const frame of stream) {
              if (!socket.write(`${JSON.stringify({ stream: true, frame })}
`)) {
                await new Promise((resolveDrain, reject) => {
                  socket.once("drain", resolveDrain);
                  socket.once("error", reject);
                });
              }
            }
            const record = await stream.completion;
            socket.end(`${JSON.stringify({ done: true, record })}
`);
            return;
          }
          socket.end(`${JSON.stringify({ ok: true, value: await dispatch(gateway, request) })}
`);
        } catch (error) {
          if (!socket.destroyed) socket.end(`${JSON.stringify(failure(error))}
`);
        }
      })();
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  if (process.platform !== "win32") try {
    await chmod(path, 384);
  } catch {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    throw new AiRuntimeError("GATEWAY_IPC_PERMISSIONS", "Unable to restrict Gateway IPC socket permissions");
  }
  return {
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose) => server.close(() => resolveClose()));
      if (process.platform !== "win32") await rm(path, { force: true });
    }
  };
}
async function connectRuntimeGateway(options = {}) {
  const root = resolve(options.root ?? defaultRoot());
  const secret = await token(root, false);
  const call = (operation, args = []) => new Promise((resolveCall, reject) => {
    const socket = createConnection(endpoint(root));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.once("error", (error) => reject(new AiRuntimeError("GATEWAY_UNAVAILABLE", "Runtime Gateway is not running", { cause: error })));
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: secret, operation, args })}
`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response.ok) reject(new AiRuntimeError(response.error.code, response.error.message));
        else resolveCall(response.value);
      } catch (error) {
        reject(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned an invalid response", { cause: error }));
      }
    });
  });
  const watchRun = (id, runId, watch = {}) => new Promise((resolveStream, rejectStream) => {
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
    const queue = [];
    let wake;
    let terminalError;
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolveRun, rejectRun) => {
      resolveCompletion = resolveRun;
      rejectCompletion = rejectRun;
    });
    void completion.catch(() => {
    });
    let stream;
    const notify = () => {
      const current = wake;
      wake = void 0;
      current?.();
    };
    const fail = (error) => {
      if (closed) return;
      closed = true;
      terminalError = error instanceof AiRuntimeError || error instanceof DOMException ? error : new AiRuntimeError("GATEWAY_UNAVAILABLE", "Gateway stream connection failed", { cause: error });
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
        args: [id, runId, { mode: watch.mode, afterSequence: watch.afterSequence }]
      })}
`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 5 * 1048576) {
        fail(new AiRuntimeError("GATEWAY_RESPONSE_INVALID", "Gateway stream frame exceeds the IPC limit"));
        socket.destroy();
        return;
      }
      for (; ; ) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let response;
        try {
          response = JSON.parse(line);
        } catch (error) {
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
          const value = response.value;
          acknowledged = true;
          stream = {
            runId: value.runId,
            mode: value.mode,
            get lastSequence() {
              return cursor;
            },
            completion,
            async *[Symbol.asyncIterator]() {
              if (consumed) throw new AiRuntimeError("GATEWAY_STREAM_ALREADY_CONSUMED", "Gateway run stream only supports one consumer");
              consumed = true;
              try {
                for (; ; ) {
                  while (queue.length) {
                    const frame = queue.shift();
                    cursor = Math.max(cursor, frame.sequence);
                    yield frame;
                  }
                  if (closed) {
                    if (terminalError) throw terminalError;
                    return;
                  }
                  await new Promise((resolveWake) => {
                    wake = resolveWake;
                  });
                }
              } finally {
                if (!closed) {
                  fail(new DOMException("Gateway stream consumer stopped", "AbortError"));
                  socket.destroy();
                }
              }
            }
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
    ping: () => call("ping"),
    listApps: () => call("listApps"),
    install: (path, install) => call("install", [path, install]),
    enable: (id) => call("enable", [id]),
    disable: (id) => call("disable", [id]),
    uninstall: (id) => call("uninstall", [id]),
    runNow: (id, triggerId) => call("runNow", [id, triggerId]),
    startRunNow: (id, triggerId, start) => call("startRunNow", [id, triggerId, start]),
    watchRun,
    listRuns: (id) => call("listRuns", [id]),
    listInbox: (id) => call("listInbox", [id]),
    markInboxRead: (id, ids) => call("markInboxRead", [id, ids]),
    retryDelivery: (id, notificationId) => call("retryDelivery", [id, notificationId])
  };
}
var init_gateway_ipc = __esm({
  "src/gateway-ipc.ts"() {
    "use strict";
  }
});

// src/gateway.ts
import { createHash as createHash2, createHmac, randomUUID } from "node:crypto";
import { appendFile, chmod as chmod2, mkdir as mkdir2, open, readFile as readFile2, readdir, rename, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join2, resolve as resolve2 } from "node:path";
import {
  AiRuntimeError as AiRuntimeError2,
  createSafeOutboundFetch,
  executeGatewayTrigger,
  inspectGatewayPackage,
  validateResolvedPublicUrl
} from "@agcomm/ai-runtime/gateway-host";

// src/background-schedule.ts
var FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7, sunday: true }
];
function fieldValue(raw, field) {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid Cron value: ${raw}`);
  const value = Number(raw);
  if (value < field.min || value > field.max) throw new Error(`Cron value out of range: ${raw}`);
  return field.sunday && value === 7 ? 0 : value;
}
function parseField(source, field) {
  const values = /* @__PURE__ */ new Set();
  for (const part of source.split(",")) {
    if (!part) throw new Error("Cron field contains an empty list item");
    const [rangeSource, stepSource, extra] = part.split("/");
    if (extra !== void 0) throw new Error(`Invalid Cron step: ${part}`);
    const step = stepSource === void 0 ? 1 : Number(stepSource);
    if (!Number.isInteger(step) || step < 1 || step > field.max - field.min + 1) throw new Error(`Invalid Cron step: ${part}`);
    let start = field.min;
    let end = field.max;
    if (rangeSource !== "*") {
      const range = rangeSource.split("-");
      if (range.length > 2) throw new Error(`Invalid Cron range: ${part}`);
      start = fieldValue(range[0], field);
      end = range.length === 2 ? fieldValue(range[1], field) : start;
      if (field.sunday && range.length === 2 && range[1] === "7") end = 7;
      if (start > end) throw new Error(`Descending Cron range is not supported: ${part}`);
    }
    for (let value = start; value <= end; value += step) values.add(field.sunday && value === 7 ? 0 : value);
  }
  return values;
}
function parseCronExpression(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must contain exactly five fields");
  const parsed = parts.map((part, index) => parseField(part, FIELDS[index]));
  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
    anyDayOfMonth: parts[2] === "*",
    anyDayOfWeek: parts[4] === "*"
  };
}
function assertTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch (error) {
    throw new Error(`Invalid IANA timezone: ${timezone}`, { cause: error });
  }
}
function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  return { minute: value("minute"), hour: value("hour"), day: value("day"), month: value("month"), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday ?? "") };
}
function cronMatches(parsed, date, timezone) {
  const value = zonedParts(date, timezone);
  const dayOfMonth = parsed.dayOfMonth.has(value.day);
  const dayOfWeek = parsed.dayOfWeek.has(value.weekday);
  const dayMatches = parsed.anyDayOfMonth ? dayOfWeek : parsed.anyDayOfWeek ? dayOfMonth : dayOfMonth || dayOfWeek;
  return parsed.minute.has(value.minute) && parsed.hour.has(value.hour) && parsed.month.has(value.month) && dayMatches;
}
function nextCronOccurrence(expression, timezone, after, limitMinutes = 2 * 366 * 24 * 60) {
  assertTimeZone(timezone);
  const parsed = typeof expression === "string" ? parseCronExpression(expression) : expression;
  const cursor = new Date(Math.floor(after.getTime() / 6e4) * 6e4 + 6e4);
  for (let index = 0; index < limitMinutes; index++, cursor.setTime(cursor.getTime() + 6e4)) {
    if (cronMatches(parsed, cursor, timezone)) return new Date(cursor);
  }
  throw new Error("Cron expression has no occurrence within the supported two-year window");
}

// src/gateway.ts
var RETRY_DELAYS = [6e4, 3e5, 18e5, 72e5];
var MAX_INBOX = 1e4;
var INBOX_RETENTION_MS = 90 * 24 * 60 * 6e4;
var STREAM_RETENTION_MS = 7 * 24 * 60 * 6e4;
var MAX_STREAM_RUNS = 100;
var MAX_STREAM_BYTES = 4 * 1048576;
function defaultRoot2() {
  return join2(homedir2(), ".agcomm", "runtime", "gateway");
}
function hashBytes(bytes) {
  return createHash2("sha256").update(bytes).digest("hex");
}
function appId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new AiRuntimeError2("GATEWAY_APP_ID_INVALID", `Invalid Gateway app id: ${value}`);
  return value;
}
function summary(value, limit = 4096) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.slice(0, limit);
}
function errorText(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4096);
}
async function atomicWrite(path, value) {
  await mkdir2(dirname(path), { recursive: true, mode: 448 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile2(temporary, value, { mode: 384 });
    await rename(temporary, path);
    try {
      await chmod2(path, 384);
    } catch {
    }
  } catch (error) {
    await rm2(temporary, { force: true });
    throw new AiRuntimeError2("GATEWAY_WRITE_FAILED", `Unable to write Gateway state: ${path}`, { cause: error });
  }
}
async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile2(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new AiRuntimeError2("GATEWAY_STATE_CORRUPT", `Gateway state is invalid: ${path}`, { cause: error });
  }
}
function wait(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolveWait, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolveWait();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function createGatewayCredentialStore() {
  const entry = async (id) => {
    try {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      return new AsyncEntry("io.agcomm.runtime.gateway.webhook", appId(id));
    } catch (error) {
      throw new AiRuntimeError2("NATIVE_CREDENTIAL_UNAVAILABLE", "Gateway webhook credential storage is unavailable", { cause: error });
    }
  };
  return {
    async get(id) {
      try {
        return await (await entry(id)).getPassword();
      } catch (error) {
        throw new AiRuntimeError2("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to read Gateway webhook secret", { cause: error });
      }
    },
    async set(id, secret) {
      try {
        await (await entry(id)).setPassword(secret);
      } catch (error) {
        throw new AiRuntimeError2("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to save Gateway webhook secret", { cause: error });
      }
    },
    async delete(id) {
      try {
        await (await entry(id)).deleteCredential();
      } catch {
      }
    }
  };
}
var RuntimeGateway = class {
  constructor(options = {}) {
    this.options = options;
    this.root = resolve2(options.root ?? defaultRoot2());
    this.credentials = options.credentialStore ?? createGatewayCredentialStore();
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    for (const adapter of options.notificationAdapters ?? []) {
      if (!adapter.id || this.adapters.has(adapter.id) || adapter.id === "webhook") throw new AiRuntimeError2("NOTIFICATION_ADAPTER_INVALID", `Invalid or duplicate notification adapter: ${adapter.id}`);
      this.adapters.set(adapter.id, adapter);
    }
  }
  options;
  root;
  registry = { version: 1, apps: [] };
  credentials;
  adapters = /* @__PURE__ */ new Map();
  now;
  timer;
  ipc;
  ticking = false;
  lockOwner;
  stateLocks = /* @__PURE__ */ new Map();
  active = /* @__PURE__ */ new Map();
  activeRunIds = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  completions = /* @__PURE__ */ new Map();
  streams = /* @__PURE__ */ new Map();
  registryPath() {
    return join2(this.root, "registry.json");
  }
  appDirectory(id) {
    return join2(this.root, "apps", appId(id));
  }
  statePath(id, name) {
    return join2(this.root, "state", appId(id), name);
  }
  streamDirectory(id) {
    return this.statePath(id, "streams");
  }
  streamPath(id, runId) {
    return join2(this.streamDirectory(id), `${runId}.ndjson`);
  }
  async withStateLock(key, action) {
    const previous = this.stateLocks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.then(() => current);
    this.stateLocks.set(key, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.stateLocks.get(key) === queued) this.stateLocks.delete(key);
    }
  }
  async acquireInstanceLock() {
    const path = join2(this.root, "gateway.lock");
    await mkdir2(this.root, { recursive: true, mode: 448 });
    const owner = `${process.pid}:${randomUUID()}`;
    const value = `${JSON.stringify({ version: 1, owner, pid: process.pid, startedAt: this.now().toISOString() })}
`;
    const attempt = async () => {
      const handle = await open(path, "wx", 384);
      try {
        await handle.writeFile(value);
      } finally {
        await handle.close();
      }
    };
    try {
      await attempt();
    } catch (error) {
      if (error.code !== "EEXIST") throw new AiRuntimeError2("GATEWAY_LOCK_FAILED", "Unable to acquire Runtime Gateway process lock", { cause: error });
      const lock = await readJson(path, {});
      const liveness = await readJson(join2(this.root, "liveness.json"), {});
      const latest = Math.max(Date.parse(lock.startedAt ?? ""), Date.parse(liveness.at ?? ""));
      if (Number.isFinite(latest) && this.now().getTime() - latest < 9e4) throw new AiRuntimeError2("GATEWAY_ALREADY_RUNNING", "Another Runtime Gateway instance is active");
      await rm2(path, { force: true });
      try {
        await attempt();
      } catch (retryError) {
        throw new AiRuntimeError2("GATEWAY_ALREADY_RUNNING", "Another Runtime Gateway instance acquired the process lock", { cause: retryError });
      }
    }
    this.lockOwner = owner;
  }
  async releaseInstanceLock() {
    if (!this.lockOwner) return;
    const path = join2(this.root, "gateway.lock");
    try {
      const value = await readJson(path, {});
      if (value.owner === this.lockOwner) await rm2(path, { force: true });
    } finally {
      this.lockOwner = void 0;
    }
  }
  async initialize() {
    await mkdir2(join2(this.root, "apps"), { recursive: true, mode: 448 });
    await mkdir2(join2(this.root, "state"), { recursive: true, mode: 448 });
    this.registry = await readJson(this.registryPath(), { version: 1, apps: [] });
    if (this.registry.version !== 1 || !Array.isArray(this.registry.apps)) throw new AiRuntimeError2("GATEWAY_STATE_CORRUPT", "Unsupported Gateway registry version");
    const now = this.now();
    for (const app of this.registry.apps) {
      app.defaultStreamMode ??= "text";
      if (app.enabled && app.background.heartbeat) app.nextRuns[app.background.heartbeat.id] = new Date(now.getTime() + app.background.heartbeat.everyMs).toISOString();
      const runs = await this.listRuns(app.id);
      let changed = false;
      for (const run of runs) if (run.status === "queued" || run.status === "running") {
        run.status = "cancelled";
        run.finishedAt = now.toISOString();
        run.elapsedMs = Math.max(0, now.getTime() - Date.parse(run.startedAt));
        run.error = "Gateway restarted before the run completed";
        changed = true;
      }
      if (changed) await this.writeRuns(app.id, runs);
      await this.cleanupStreams(app.id, runs);
    }
    await this.saveRegistry();
    return this;
  }
  async status() {
    const liveness = await readJson(join2(this.root, "liveness.json"), {});
    const heartbeatAt = typeof liveness.at === "string" ? liveness.at : void 0;
    const healthy = Boolean(heartbeatAt && this.now().getTime() - Date.parse(heartbeatAt) <= 9e4);
    return { alive: true, pid: liveness.pid ?? process.pid, heartbeatAt, healthy };
  }
  async saveRegistry() {
    await atomicWrite(this.registryPath(), `${JSON.stringify(this.registry, null, 2)}
`);
  }
  async writeRuns(id, runs) {
    await atomicWrite(this.statePath(id, "runs.json"), `${JSON.stringify(runs.slice(-1e3), null, 2)}
`);
  }
  async upsertRun(id, record) {
    await this.withStateLock(`${id}:runs`, async () => {
      const runs = await readJson(this.statePath(id, "runs.json"), []);
      const index = runs.findIndex((run) => run.id === record.id);
      if (index >= 0) runs[index] = structuredClone(record);
      else runs.push(structuredClone(record));
      await this.writeRuns(id, runs);
    });
  }
  completion(runId) {
    const existing = this.completions.get(runId);
    if (existing) return existing;
    let resolveCompletion;
    const promise = new Promise((resolveRun) => {
      resolveCompletion = resolveRun;
    });
    const created = { promise, resolve: resolveCompletion };
    this.completions.set(runId, created);
    return created;
  }
  async runRecord(id, runId) {
    const record = (await this.listRuns(id)).find((run) => run.id === runId);
    if (!record) throw new AiRuntimeError2("GATEWAY_RUN_NOT_FOUND", `Gateway run was not found: ${runId}`);
    return record;
  }
  async waitForRun(id, runId) {
    const record = await this.runRecord(id, runId);
    if (record.status === "completed" || record.status === "failed" || record.status === "cancelled") return record;
    return this.completion(runId).promise;
  }
  createStreamState(app, record, controller) {
    const state = { appId: app.id, runId: record.id, mode: record.streamMode, sequence: 0, bytes: 0, tail: Promise.resolve(), controller };
    this.streams.set(record.id, state);
    return state;
  }
  appendStream(state, value) {
    const frame = { sequence: state.sequence + 1, value };
    const line = `${JSON.stringify(frame)}
`;
    const bytes = Buffer.byteLength(line, "utf8");
    if (state.bytes + bytes > MAX_STREAM_BYTES) {
      const error = new AiRuntimeError2("GATEWAY_STREAM_LIMIT_EXCEEDED", "Gateway stream log exceeds 4 MiB");
      state.controller.abort(error);
      throw error;
    }
    state.sequence = frame.sequence;
    state.bytes += bytes;
    state.tail = state.tail.then(async () => {
      await mkdir2(this.streamDirectory(state.appId), { recursive: true, mode: 448 });
      await appendFile(this.streamPath(state.appId, state.runId), line, { encoding: "utf8", mode: 384 });
    }).catch((error) => {
      const failure2 = error instanceof AiRuntimeError2 ? error : new AiRuntimeError2("GATEWAY_WRITE_FAILED", "Unable to append Gateway stream log", { cause: error });
      state.controller.abort(failure2);
      throw failure2;
    });
    return frame;
  }
  async readStreamFrames(id, runId, afterSequence) {
    let text = "";
    try {
      text = await readFile2(this.streamPath(id, runId), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return void 0;
      throw new AiRuntimeError2("GATEWAY_STATE_CORRUPT", `Unable to read stream log for ${runId}`, { cause: error });
    }
    const lines = text.split("\n");
    const frames = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line) continue;
      try {
        const frame = JSON.parse(line);
        if (Number.isInteger(frame.sequence) && frame.sequence > afterSequence) frames.push(frame);
      } catch (error) {
        if (index === lines.length - 1) break;
        throw new AiRuntimeError2("GATEWAY_STATE_CORRUPT", `Gateway stream log is invalid for ${runId}`, { cause: error });
      }
    }
    return frames.sort((left, right) => left.sequence - right.sequence);
  }
  async cleanupStreams(id, existingRuns) {
    const runs = existingRuns ?? await this.listRuns(id);
    const cutoff = this.now().getTime() - STREAM_RETENTION_MS;
    const retained = [...runs].filter((run) => Date.parse(run.startedAt) >= cutoff).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, MAX_STREAM_RUNS);
    const keep = new Set(retained.map((run) => `${run.id}.ndjson`));
    let names = [];
    try {
      names = await readdir(this.streamDirectory(id));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await Promise.all(names.filter((name) => name.endsWith(".ndjson") && !keep.has(name)).map((name) => rm2(join2(this.streamDirectory(id), name), { force: true })));
  }
  app(id) {
    const item = this.registry.apps.find((app) => app.id === id);
    if (!item) throw new AiRuntimeError2("GATEWAY_APP_NOT_FOUND", `Gateway app was not found: ${id}`);
    return item;
  }
  triggers(background) {
    return [...background.heartbeat ? [background.heartbeat] : [], ...background.cron ?? []];
  }
  nextRun(trigger, after) {
    return "everyMs" in trigger ? new Date(after.getTime() + trigger.everyMs) : nextCronOccurrence(trigger.expression, trigger.timezone, after);
  }
  async install(pathOrBytes, install = {}) {
    const bytes = typeof pathOrBytes === "string" ? new Uint8Array(await readFile2(pathOrBytes)) : pathOrBytes instanceof Uint8Array ? new Uint8Array(pathOrBytes) : new Uint8Array(pathOrBytes);
    const inspected = await inspectGatewayPackage(bytes, this.options.runtime);
    const id = appId(inspected.appId);
    const requiresWebhook = inspected.requiresWebhook;
    const existing = this.registry.apps.find((app) => app.id === id);
    const webhookUrl = install.webhook?.url ?? existing?.webhookUrl;
    if (requiresWebhook && !webhookUrl) throw new AiRuntimeError2("GATEWAY_WEBHOOK_REQUIRED", `App ${id} requires a Webhook URL`);
    if (webhookUrl) {
      const url = new URL(webhookUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new AiRuntimeError2("GATEWAY_WEBHOOK_INVALID", "Webhook URL must be credential-free HTTPS without a query or fragment");
      try {
        await validateResolvedPublicUrl(url, { signal: new AbortController().signal });
      } catch (error) {
        throw new AiRuntimeError2("GATEWAY_WEBHOOK_INVALID", "Webhook URL must resolve to a public HTTPS endpoint", { cause: error });
      }
    }
    if (install.webhook?.secret !== void 0) {
      if (install.webhook.secret.length < 16 || install.webhook.secret.length > 512) throw new AiRuntimeError2("GATEWAY_WEBHOOK_SECRET_INVALID", "Webhook signing secret must contain 16\u2013512 characters");
      await this.credentials.set(id, install.webhook.secret);
    } else if (requiresWebhook && !await this.credentials.get(id)) {
      throw new AiRuntimeError2("GATEWAY_WEBHOOK_REQUIRED", `App ${id} requires a Webhook signing secret`);
    }
    const configuredAdapters = [...new Set(install.notificationAdapters ?? existing?.notificationAdapters ?? [])];
    for (const adapter of configuredAdapters) if (!this.adapters.has(adapter)) throw new AiRuntimeError2("NOTIFICATION_ADAPTER_NOT_FOUND", `Notification adapter is not registered: ${adapter}`);
    const now = this.now();
    const packageHash = hashBytes(bytes);
    if (packageHash !== inspected.packageHash) throw new AiRuntimeError2("GATEWAY_PACKAGE_INVALID", "Runtime package hash does not match the installed bytes");
    if (existing && existing.packageHash !== packageHash) {
      await this.stopActive(id, "Gateway app package was replaced");
      await this.cancelPending(id, "Gateway app package was replaced");
    }
    await mkdir2(this.appDirectory(id), { recursive: true, mode: 448 });
    await atomicWrite(join2(this.appDirectory(id), "app.ai"), bytes);
    const nextRuns = {};
    for (const trigger of this.triggers(inspected.background)) {
      nextRuns[trigger.id] = ("everyMs" in trigger && trigger.runOnStart ? now : this.nextRun(trigger, now)).toISOString();
    }
    const record = {
      id,
      name: inspected.name,
      version: inspected.version,
      packageHash,
      enabled: install.enabled !== false,
      installedAt: existing?.installedAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      background: structuredClone(inspected.background),
      requiresWebhook,
      ...webhookUrl ? { webhookUrl } : {},
      notificationAdapters: configuredAdapters,
      nextRuns,
      defaultStreamMode: inspected.defaultStreamMode
    };
    this.registry.apps = [...this.registry.apps.filter((app) => app.id !== id), record];
    if (existing?.packageHash !== packageHash) await atomicWrite(this.statePath(id, "sessions.json"), "{}\n");
    await this.saveRegistry();
    return structuredClone(record);
  }
  async enable(id) {
    const app = this.app(id);
    app.enabled = true;
    app.updatedAt = this.now().toISOString();
    for (const trigger of this.triggers(app.background)) app.nextRuns[trigger.id] = this.nextRun(trigger, this.now()).toISOString();
    await this.saveRegistry();
  }
  async disable(id) {
    const app = this.app(id);
    app.enabled = false;
    app.updatedAt = this.now().toISOString();
    await this.stopActive(id, "Gateway app disabled");
    await this.cancelPending(id, "Gateway app is disabled");
    await this.saveRegistry();
  }
  async uninstall(id) {
    this.app(id);
    await this.stopActive(id, "Gateway app uninstalled");
    await this.cancelPending(id, "Gateway app was uninstalled");
    this.registry.apps = this.registry.apps.filter((app) => app.id !== id);
    await this.saveRegistry();
    await this.credentials.delete(id);
    await rm2(this.appDirectory(id), { recursive: true, force: true });
  }
  async listApps() {
    return structuredClone(this.registry.apps).sort((a, b) => a.name.localeCompare(b.name));
  }
  async listRuns(id) {
    this.app(id);
    const runs = await readJson(this.statePath(id, "runs.json"), []);
    return runs.map((run) => ({
      ...run,
      streamMode: run.streamMode ?? "text",
      lastSequence: run.lastSequence ?? 0,
      streamExpiresAt: run.streamExpiresAt ?? new Date(Date.parse(run.startedAt) + STREAM_RETENTION_MS).toISOString()
    }));
  }
  async listInbox(id) {
    this.app(id);
    return readJson(this.statePath(id, "inbox.json"), []);
  }
  async markInboxRead(id, notificationIds) {
    this.app(id);
    await this.withStateLock(`${id}:notifications`, async () => {
      const set = new Set(notificationIds);
      const inbox = await readJson(this.statePath(id, "inbox.json"), []);
      const at = this.now().toISOString();
      for (const item of inbox) if (set.has(item.id)) item.readAt = at;
      await atomicWrite(this.statePath(id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}
`);
    });
  }
  async retryDelivery(id, notificationId) {
    this.app(id);
    await this.withStateLock(`${id}:notifications`, async () => {
      const deliveries = await readJson(this.statePath(id, "deliveries.json"), []);
      let found = false;
      for (const delivery of deliveries) if (delivery.notificationId === notificationId && delivery.status === "failed") {
        delivery.status = "queued";
        delivery.attempts = 0;
        delivery.nextAttemptAt = this.now().toISOString();
        delete delivery.lastError;
        found = true;
      }
      if (!found) throw new AiRuntimeError2("GATEWAY_DELIVERY_NOT_FOUND", `Failed delivery was not found: ${notificationId}`);
      await atomicWrite(this.statePath(id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}
`);
    });
  }
  async recordContact(app, request) {
    return this.withStateLock(`${app.id}:notifications`, async () => {
      const now = this.now();
      let inbox = await readJson(this.statePath(app.id, "inbox.json"), []);
      inbox = inbox.filter((item2) => now.getTime() - new Date(item2.updatedAt).getTime() <= INBOX_RETENTION_MS);
      const duplicate = request.dedupeKey ? inbox.find((item2) => item2.dedupeKey === request.dedupeKey && now.getTime() - new Date(item2.updatedAt).getTime() < 24 * 60 * 6e4) : void 0;
      if (duplicate) return { id: duplicate.id, status: "queued", webhookQueued: duplicate.deliveryStatus === "queued", createdAt: duplicate.createdAt };
      const adapters = [...app.notificationAdapters, ...request.webhook ? ["webhook"] : []];
      const item = {
        id: randomUUID(),
        appId: app.id,
        packageHash: app.packageHash,
        nodeId: request.nodeId,
        triggerId: request.trigger.id,
        runId: request.trigger.runId,
        title: request.title,
        body: request.body,
        severity: request.severity,
        ...request.dedupeKey ? { dedupeKey: request.dedupeKey } : {},
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        deliveryStatus: adapters.length ? "queued" : "none"
      };
      inbox.push(item);
      if (inbox.length > MAX_INBOX) inbox = inbox.slice(-MAX_INBOX);
      await atomicWrite(this.statePath(app.id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}
`);
      if (adapters.length) {
        const deliveries = await readJson(this.statePath(app.id, "deliveries.json"), []);
        for (const adapterId of new Set(adapters)) deliveries.push({ id: randomUUID(), notificationId: item.id, adapterId, attempts: 0, nextAttemptAt: now.toISOString(), status: "queued" });
        await atomicWrite(this.statePath(app.id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}
`);
      }
      return { id: item.id, status: "queued", webhookQueued: request.webhook, createdAt: item.createdAt };
    });
  }
  previousRun(runs, triggerId) {
    const previous = [...runs].reverse().find((run) => run.triggerId === triggerId && (run.status === "completed" || run.status === "failed") && run.finishedAt);
    return previous ? {
      status: previous.status,
      finishedAt: previous.finishedAt,
      ...previous.outputSummary ? { outputSummary: previous.outputSummary } : {}
    } : void 0;
  }
  baseRunRecord(app, trigger, scheduledAt, runId, mode, status) {
    const now = this.now();
    return {
      id: runId,
      appId: app.id,
      packageHash: app.packageHash,
      triggerId: trigger.id,
      triggerType: "everyMs" in trigger ? "heartbeat" : "cron",
      scheduledAt: scheduledAt.toISOString(),
      startedAt: now.toISOString(),
      status,
      streamMode: mode,
      lastSequence: 0,
      streamExpiresAt: new Date(now.getTime() + STREAM_RETENTION_MS).toISOString()
    };
  }
  async cancelPending(id, reason) {
    const queued = this.pending.get(id);
    this.pending.delete(id);
    if (!queued?.size) return;
    const now = this.now();
    for (const pending of queued.values()) {
      const record = await this.runRecord(id, pending.runId);
      record.status = "cancelled";
      record.finishedAt = now.toISOString();
      record.elapsedMs = Math.max(0, now.getTime() - Date.parse(record.startedAt));
      record.error = reason;
      await this.upsertRun(id, record);
      this.completion(record.id).resolve(structuredClone(record));
      this.completions.delete(record.id);
    }
  }
  async stopActive(id, reason) {
    const controller = this.active.get(id);
    const runId = this.activeRunIds.get(id);
    if (!controller || !runId) return;
    controller.abort(new DOMException(reason, "AbortError"));
    await this.completion(runId).promise;
  }
  launchTrigger(app, trigger, scheduledAt, record, controller) {
    void this.executeTrigger(app, trigger, scheduledAt, record, controller).catch(async (error) => {
      if (this.active.get(app.id) === controller) {
        this.active.delete(app.id);
        this.activeRunIds.delete(app.id);
      }
      this.streams.delete(record.id);
      const current = await this.runRecord(app.id, record.id).catch(() => record);
      if (current.status !== "queued" && current.status !== "running") return;
      const reason = controller.signal.aborted ? controller.signal.reason ?? error : error;
      current.status = reason instanceof DOMException && reason.name === "AbortError" ? "cancelled" : "failed";
      current.error = errorText(reason);
      current.finishedAt = this.now().toISOString();
      current.elapsedMs = Math.max(0, this.now().getTime() - Date.parse(current.startedAt));
      await this.upsertRun(app.id, current).catch(() => {
      });
      this.completions.get(record.id)?.resolve(structuredClone(current));
      this.completions.delete(record.id);
    });
  }
  async startTrigger(app, trigger, scheduledAt, mode) {
    if (this.active.has(app.id)) {
      const queue = this.pending.get(app.id) ?? /* @__PURE__ */ new Map();
      const existing = queue.get(trigger.id);
      if (existing) return { runId: existing.runId, status: "queued", coalesced: true };
      const runId2 = randomUUID();
      this.completion(runId2);
      queue.set(trigger.id, { runId: runId2, trigger, scheduledAt, mode });
      this.pending.set(app.id, queue);
      await this.upsertRun(app.id, this.baseRunRecord(app, trigger, scheduledAt, runId2, mode, "queued"));
      return { runId: runId2, status: "queued", coalesced: false };
    }
    const controller = new AbortController();
    this.active.set(app.id, controller);
    const runId = randomUUID();
    this.completion(runId);
    const record = this.baseRunRecord(app, trigger, scheduledAt, runId, mode, "running");
    try {
      await this.upsertRun(app.id, record);
    } catch (error) {
      this.active.delete(app.id);
      throw error;
    }
    this.activeRunIds.set(app.id, runId);
    this.launchTrigger(app, trigger, scheduledAt, record, controller);
    return { runId, status: "running", coalesced: false };
  }
  async executeTrigger(app, trigger, scheduledAt, record, controller) {
    const started = this.now();
    record.status = "running";
    record.startedAt = started.toISOString();
    await this.upsertRun(app.id, record);
    const runs = await readJson(this.statePath(app.id, "runs.json"), []);
    const triggerContext = {
      type: "everyMs" in trigger ? "heartbeat" : "cron",
      id: trigger.id,
      scheduledAt: scheduledAt.toISOString(),
      firedAt: started.toISOString(),
      appId: app.id,
      packageHash: app.packageHash,
      runId: record.id,
      attempt: 1,
      ...this.previousRun(runs, trigger.id) ? { previous: this.previousRun(runs, trigger.id) } : {}
    };
    await rm2(this.streamPath(app.id, record.id), { force: true });
    const stream = this.createStreamState(app, record, controller);
    try {
      const sessions = await readJson(this.statePath(app.id, "sessions.json"), {});
      const session = sessions[trigger.id]?.packageHash === app.packageHash ? sessions[trigger.id] : { messages: [], packageHash: app.packageHash };
      const result = await executeGatewayTrigger(join2(this.appDirectory(app.id), "app.ai"), this.options.runtime, {
        input: trigger.input,
        variables: trigger.variables,
        signal: controller.signal,
        renderer: false,
        mode: record.streamMode,
        ...record.streamMode === "events" ? { onStreamEvent: (event) => {
          this.appendStream(stream, event);
        } } : { onOutputDelta: (text) => {
          this.appendStream(stream, text);
        } }
      }, {
        trigger: triggerContext,
        history: session.messages,
        contact: (request) => this.recordContact(app, request)
      });
      await stream.tail;
      session.messages.push({ role: "user", content: trigger.input }, { role: "assistant", content: summary(result.output, 64e3) });
      session.messages = session.messages.slice(-(app.background.historyWindow ?? 20));
      sessions[trigger.id] = session;
      await atomicWrite(this.statePath(app.id, "sessions.json"), `${JSON.stringify(sessions, null, 2)}
`);
      record.status = "completed";
      record.outputSummary = summary(result.output);
    } catch (error) {
      try {
        await stream.tail;
      } catch (streamError) {
        error = streamError;
      }
      const reason = controller.signal.aborted ? controller.signal.reason ?? error : error;
      record.status = reason instanceof DOMException && reason.name === "AbortError" ? "cancelled" : "failed";
      record.error = errorText(reason);
    }
    record.lastSequence = stream.sequence;
    record.finishedAt = this.now().toISOString();
    record.elapsedMs = this.now().getTime() - started.getTime();
    await this.upsertRun(app.id, record);
    if (this.active.get(app.id) === controller) {
      this.active.delete(app.id);
      this.activeRunIds.delete(app.id);
    }
    this.streams.delete(record.id);
    this.completion(record.id).resolve(structuredClone(record));
    this.completions.delete(record.id);
    await this.cleanupStreams(app.id);
    const queued = this.pending.get(app.id);
    const next = queued?.values().next().value;
    if (next) {
      queued.delete(next.trigger.id);
      if (!queued.size) this.pending.delete(app.id);
      const current = this.registry.apps.find((item) => item.id === app.id && item.enabled);
      if (current) {
        const nextController = new AbortController();
        this.active.set(app.id, nextController);
        this.activeRunIds.set(app.id, next.runId);
        const nextRecord = await this.runRecord(app.id, next.runId);
        this.launchTrigger(current, next.trigger, next.scheduledAt, nextRecord, nextController);
      } else {
        const cancelled = await this.runRecord(app.id, next.runId);
        cancelled.status = "cancelled";
        cancelled.finishedAt = this.now().toISOString();
        cancelled.elapsedMs = 0;
        cancelled.error = "Gateway app is disabled";
        await this.upsertRun(app.id, cancelled);
        this.completion(next.runId).resolve(cancelled);
        this.completions.delete(next.runId);
      }
    }
  }
  async startRunNow(id, triggerId, options = {}) {
    const app = this.app(id);
    const trigger = this.triggers(app.background).find((item) => item.id === triggerId);
    if (!trigger) throw new AiRuntimeError2("GATEWAY_TRIGGER_NOT_FOUND", `Trigger was not found: ${triggerId}`);
    const mode = options.mode ?? app.defaultStreamMode ?? "text";
    if (mode !== "text" && mode !== "events") throw new AiRuntimeError2("GATEWAY_STREAM_MODE_INVALID", `Unsupported stream mode: ${mode}`);
    return this.startTrigger(app, trigger, this.now(), mode);
  }
  async watchRun(id, runId, options = {}) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    const initial = await this.runRecord(id, runId);
    if (Date.parse(initial.streamExpiresAt) <= this.now().getTime() && (initial.status === "completed" || initial.status === "failed" || initial.status === "cancelled")) {
      throw new AiRuntimeError2("GATEWAY_STREAM_EXPIRED", `Gateway stream has expired: ${runId}`);
    }
    const mode = options.mode ?? initial.streamMode;
    if (mode === "events" && initial.streamMode !== "events") {
      throw new AiRuntimeError2("GATEWAY_STREAM_MODE_UNAVAILABLE", "A text-only Gateway run cannot be replayed as full events");
    }
    let cursor = Math.max(0, Math.floor(options.afterSequence ?? 0));
    let consumed = false;
    const completion = this.waitForRun(id, runId);
    const self = this;
    return {
      runId,
      mode,
      get lastSequence() {
        return cursor;
      },
      completion,
      async *[Symbol.asyncIterator]() {
        if (consumed) throw new AiRuntimeError2("GATEWAY_STREAM_ALREADY_CONSUMED", "Gateway run stream only supports one consumer");
        consumed = true;
        for (; ; ) {
          const storedFrames = await self.readStreamFrames(id, runId, cursor);
          const frames = storedFrames ?? [];
          for (const frame of frames) {
            cursor = Math.max(cursor, frame.sequence);
            if (mode === "text" && initial.streamMode === "events") {
              const event = frame.value;
              if (event?.type !== "output-delta") continue;
              yield { sequence: frame.sequence, value: event.text };
            } else yield frame;
          }
          const current = await self.runRecord(id, runId);
          if (!storedFrames && cursor < current.lastSequence && (current.status === "completed" || current.status === "failed" || current.status === "cancelled")) {
            throw new AiRuntimeError2("GATEWAY_STREAM_EXPIRED", `Gateway stream is no longer retained: ${runId}`);
          }
          if (storedFrames && frames.length === 0 && cursor < current.lastSequence && (current.status === "completed" || current.status === "failed" || current.status === "cancelled")) {
            throw new AiRuntimeError2("GATEWAY_STREAM_INCOMPLETE", `Gateway stream log is incomplete: ${runId}`);
          }
          if ((current.status === "completed" || current.status === "failed" || current.status === "cancelled") && cursor >= current.lastSequence) break;
          await wait(50, options.signal);
        }
      }
    };
  }
  async deliverWebhook(app, item, signal) {
    if (!app.webhookUrl) throw new AiRuntimeError2("GATEWAY_WEBHOOK_REQUIRED", `Webhook URL is missing for ${app.id}`);
    const secret = await this.credentials.get(app.id);
    if (!secret) throw new AiRuntimeError2("GATEWAY_WEBHOOK_REQUIRED", `Webhook secret is missing for ${app.id}`);
    const payload = JSON.stringify({ id: item.id, appId: item.appId, packageHash: item.packageHash, triggerId: item.triggerId, runId: item.runId, title: item.title, body: item.body, severity: item.severity, createdAt: item.createdAt });
    const timestamp = String(Math.floor(this.now().getTime() / 1e3));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    const fetcher = createSafeOutboundFetch({ maxRedirects: 0, maxResponseBytes: 65536, signal, fetcher: this.options.fetcher });
    const response = await fetcher(app.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-agcomm-event": item.id, "x-agcomm-timestamp": timestamp, "x-agcomm-signature": `sha256=${signature}` }, body: payload });
    if (!response.ok) throw new AiRuntimeError2("GATEWAY_WEBHOOK_FAILED", `Webhook returned HTTP ${response.status}`);
  }
  async deliverPending() {
    const now = this.now();
    for (const app of this.registry.apps) {
      await this.withStateLock(`${app.id}:notifications`, async () => {
        const deliveries = await readJson(this.statePath(app.id, "deliveries.json"), []);
        const inbox = await readJson(this.statePath(app.id, "inbox.json"), []);
        let changed = false;
        for (const delivery of deliveries.filter((item) => item.status === "queued" && new Date(item.nextAttemptAt) <= now)) {
          const notification = inbox.find((item) => item.id === delivery.notificationId);
          if (!notification) {
            delivery.status = "failed";
            delivery.lastError = "Inbox item was removed";
            changed = true;
            continue;
          }
          const controller = new AbortController();
          try {
            if (delivery.adapterId === "webhook") await this.deliverWebhook(app, notification, controller.signal);
            else {
              const adapter = this.adapters.get(delivery.adapterId);
              if (!adapter) throw new AiRuntimeError2("NOTIFICATION_ADAPTER_NOT_FOUND", `Notification adapter is unavailable: ${delivery.adapterId}`);
              await adapter.deliver(notification, { app: structuredClone(app), signal: controller.signal });
            }
            delivery.status = "delivered";
            notification.deliveryStatus = deliveries.some((item) => item.notificationId === notification.id && item !== delivery && item.status !== "delivered") ? "queued" : "delivered";
            delete delivery.lastError;
          } catch (error) {
            delivery.lastError = errorText(error);
            const delay = RETRY_DELAYS[delivery.attempts];
            delivery.attempts++;
            if (delay === void 0) {
              delivery.status = "failed";
              notification.deliveryStatus = "failed";
            } else delivery.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
          }
          notification.updatedAt = now.toISOString();
          changed = true;
        }
        if (changed) {
          await atomicWrite(this.statePath(app.id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}
`);
          await atomicWrite(this.statePath(app.id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}
`);
        }
      });
    }
  }
  async runNow(id, triggerId) {
    const ticket = await this.startRunNow(id, triggerId);
    await this.waitForRun(id, ticket.runId);
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      await atomicWrite(join2(this.root, "liveness.json"), `${JSON.stringify({ version: 1, pid: process.pid, at: now.toISOString() })}
`);
      await this.deliverPending();
      for (const app of this.registry.apps) await this.cleanupStreams(app.id);
      for (const app of this.registry.apps.filter((item) => item.enabled)) for (const trigger of this.triggers(app.background)) {
        const scheduledAt = new Date(app.nextRuns[trigger.id] ?? this.nextRun(trigger, now).toISOString());
        if (scheduledAt > now) continue;
        app.nextRuns[trigger.id] = this.nextRun(trigger, now).toISOString();
        if ("expression" in trigger && now.getTime() - scheduledAt.getTime() > (trigger.misfireGraceMs ?? 9e5)) continue;
        void this.startTrigger(app, trigger, scheduledAt, app.defaultStreamMode ?? "text").catch(() => {
        });
      }
      await this.saveRegistry();
    } finally {
      this.ticking = false;
    }
  }
  async start() {
    if (this.timer) return;
    await this.acquireInstanceLock();
    try {
      await this.initialize();
      const { createGatewayIpcServer: createGatewayIpcServer2 } = await Promise.resolve().then(() => (init_gateway_ipc(), gateway_ipc_exports));
      this.ipc = await createGatewayIpcServer2(this, this.root);
      await this.tick();
      this.timer = setInterval(() => {
        void this.tick();
      }, 3e4);
      this.timer.unref?.();
    } catch (error) {
      await this.releaseInstanceLock();
      throw error;
    }
  }
  async dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = void 0;
    await this.ipc?.close();
    this.ipc = void 0;
    for (const id of [...this.pending.keys()]) await this.cancelPending(id, "Gateway disposed");
    const running = [...this.activeRunIds.values()].map((runId) => this.completion(runId).promise);
    for (const controller of this.active.values()) controller.abort(new DOMException("Gateway disposed", "AbortError"));
    await Promise.all(running);
    await this.releaseInstanceLock();
  }
};
function createRuntimeGateway(options = {}) {
  return new RuntimeGateway(options);
}

// src/index.ts
init_gateway_ipc();

// src/gateway-service.ts
import { execFile } from "node:child_process";
import { mkdir as mkdir3, rm as rm3, writeFile as writeFile3 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname2, join as join3, resolve as resolve3 } from "node:path";
import { promisify } from "node:util";
import { AiRuntimeError as AiRuntimeError3 } from "@agcomm/ai-runtime/gateway-host";
var execute = promisify(execFile);
var SERVICE_NAME = "io.agcomm.runtime.gateway";
function paths(options) {
  const cliPath = resolve3(options.cliPath ?? process.argv[1] ?? "");
  const nodePath = resolve3(options.nodePath ?? process.execPath);
  const home = resolve3(options.homeDir ?? homedir3());
  if (!cliPath || /(?:^|[/\\])(?:_npx|npm-cache|Temp|tmp)(?:[/\\])/i.test(cliPath)) {
    throw new AiRuntimeError3("GATEWAY_RUNTIME_PATH_UNSTABLE", "Gateway login service requires @agcomm/ai-runtime to be installed at a stable path");
  }
  return { cliPath, nodePath, home };
}
function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function systemd(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
async function command(options, file, args, code) {
  try {
    return options.execute ? await options.execute(file, args) : await execute(file, args, { timeout: 15e3 });
  } catch (error) {
    throw new AiRuntimeError3(code, `Unable to configure Runtime Gateway login service using ${file}`, { cause: error });
  }
}
async function installGatewayAutostart(options = {}) {
  const { cliPath, nodePath, home } = paths(options);
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const path = join3(home, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
    await mkdir3(dirname2(path), { recursive: true, mode: 448 });
    await writeFile3(path, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${SERVICE_NAME}</string><key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(cliPath)}</string><string>gateway</string><string>run</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string></dict></plist>
`, { mode: 384 });
    try {
      await command(options, "launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, path], "GATEWAY_SERVICE_UNAVAILABLE");
    } catch {
    }
    await command(options, "launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, path], "GATEWAY_SERVICE_UNAVAILABLE");
    return { platform: "darwin", path };
  }
  if (platform === "win32") {
    const task = "AgComm Runtime Gateway";
    const invocation = `"${nodePath}" "${cliPath}" gateway run`;
    await command(options, "schtasks.exe", ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", task, "/TR", invocation], "GATEWAY_SERVICE_UNAVAILABLE");
    await command(options, "schtasks.exe", ["/Run", "/TN", task], "GATEWAY_SERVICE_UNAVAILABLE");
    return { platform: "win32", path: task };
  }
  if (platform === "linux") {
    const path = join3(home, ".config", "systemd", "user", "agcomm-runtime-gateway.service");
    await mkdir3(dirname2(path), { recursive: true, mode: 448 });
    await writeFile3(path, `[Unit]
Description=AgComm Runtime Gateway

[Service]
Type=simple
ExecStart=${systemd(nodePath)} ${systemd(cliPath)} gateway run
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`, { mode: 384 });
    await command(options, "systemctl", ["--user", "daemon-reload"], "GATEWAY_SERVICE_UNAVAILABLE");
    await command(options, "systemctl", ["--user", "enable", "--now", "agcomm-runtime-gateway.service"], "GATEWAY_SERVICE_UNAVAILABLE");
    return { platform: "linux", path };
  }
  throw new AiRuntimeError3("GATEWAY_SERVICE_UNAVAILABLE", `Runtime Gateway login service is not supported on ${platform}`);
}
async function uninstallGatewayAutostart(options = {}) {
  const { home } = paths(options);
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const path = join3(home, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
    try {
      await command(options, "launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, path], "GATEWAY_SERVICE_UNAVAILABLE");
    } catch {
    }
    await rm3(path, { force: true });
    return;
  }
  if (platform === "win32") {
    try {
      await command(options, "schtasks.exe", ["/Delete", "/F", "/TN", "AgComm Runtime Gateway"], "GATEWAY_SERVICE_UNAVAILABLE");
    } catch {
    }
    return;
  }
  if (platform === "linux") {
    try {
      await command(options, "systemctl", ["--user", "disable", "--now", "agcomm-runtime-gateway.service"], "GATEWAY_SERVICE_UNAVAILABLE");
    } catch {
    }
    await rm3(join3(home, ".config", "systemd", "user", "agcomm-runtime-gateway.service"), { force: true });
    await command(options, "systemctl", ["--user", "daemon-reload"], "GATEWAY_SERVICE_UNAVAILABLE");
    return;
  }
  throw new AiRuntimeError3("GATEWAY_SERVICE_UNAVAILABLE", `Runtime Gateway login service is not supported on ${platform}`);
}
export {
  RuntimeGateway,
  connectRuntimeGateway,
  createGatewayCredentialStore,
  createRuntimeGateway,
  installGatewayAutostart,
  uninstallGatewayAutostart
};
