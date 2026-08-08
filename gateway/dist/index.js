var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/gateway/GatewayFilePermissions.ts
import { chmod } from "node:fs/promises";
import { AiRuntimeError } from "@agcomm/ai-runtime/gateway-host";
async function enforceGatewayPrivateMode(path, mode) {
  await chmod(path, mode).catch((error) => {
    if (process.platform === "win32") return;
    throw new AiRuntimeError("GATEWAY_WRITE_FAILED", `Unable to restrict Gateway file permissions: ${path}`, { cause: error });
  });
}
var init_GatewayFilePermissions = __esm({
  "src/gateway/GatewayFilePermissions.ts"() {
    "use strict";
  }
});

// src/ipc/GatewayIpcAuth.ts
import { createHash as createHash2, randomBytes } from "node:crypto";
import { mkdir as mkdir5, readFile as readFile4, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join5 } from "node:path";
import { AiRuntimeError as AiRuntimeError9 } from "@agcomm/ai-runtime/gateway-host";
function defaultGatewayRoot() {
  return join5(homedir(), ".agcomm", "runtime", "gateway");
}
function gatewayIpcEndpoint(root) {
  return process.platform === "win32" ? `\\\\.\\pipe\\agcomm-${createHash2("sha256").update(root).digest("hex").slice(0, 20)}` : join5(root, "gateway.sock");
}
async function gatewayIpcToken(root, create) {
  const path = join5(root, "ipc-token");
  try {
    return (await readFile4(path, "utf8")).trim();
  } catch (error) {
    if (!create || error.code !== "ENOENT") {
      throw new AiRuntimeError9("GATEWAY_UNAVAILABLE", "Runtime Gateway IPC credentials are unavailable", { cause: error });
    }
    const value = randomBytes(32).toString("base64url");
    await mkdir5(root, { recursive: true, mode: 448 });
    await writeFile2(path, value, { encoding: "utf8", mode: 384 });
    await enforceGatewayPrivateMode(path, 384);
    return value;
  }
}
var init_GatewayIpcAuth = __esm({
  "src/ipc/GatewayIpcAuth.ts"() {
    "use strict";
    init_GatewayFilePermissions();
  }
});

// src/ipc/GatewayIpcDispatcher.ts
import { AiRuntimeError as AiRuntimeError10 } from "@agcomm/ai-runtime/gateway-host";
function gatewayIpcFailure(error) {
  return {
    ok: false,
    error: {
      code: error instanceof AiRuntimeError10 ? error.code : "GATEWAY_REQUEST_FAILED",
      message: (error instanceof Error ? error.message : String(error)).slice(0, 4096)
    }
  };
}
async function dispatchGatewayIpc(gateway, request) {
  const args = request.args ?? [];
  switch (request.operation) {
    case "ping":
      return gateway.status();
    case "listApps":
      return gateway.listApps();
    case "install":
      return gateway.install(String(args[0]), args[1] ?? {});
    case "enable":
      return gateway.enable(String(args[0]));
    case "disable":
      return gateway.disable(String(args[0]));
    case "uninstall":
      return gateway.uninstall(String(args[0]));
    case "runNow":
      return gateway.runNow(String(args[0]), String(args[1]));
    case "startRunNow":
      return gateway.startRunNow(String(args[0]), String(args[1]), args[2] ?? {});
    case "listRuns":
      return gateway.listRuns(String(args[0]));
    case "listInbox":
      return gateway.listInbox(String(args[0]));
    case "markInboxRead":
      return gateway.markInboxRead(String(args[0]), Array.isArray(args[1]) ? args[1].map(String) : []);
    case "retryDelivery":
      return gateway.retryDelivery(String(args[0]), String(args[1]));
    default:
      throw new AiRuntimeError10("GATEWAY_OPERATION_INVALID", `Unknown Gateway operation: ${request.operation}`);
  }
}
var init_GatewayIpcDispatcher = __esm({
  "src/ipc/GatewayIpcDispatcher.ts"() {
    "use strict";
  }
});

// src/ipc/GatewayIpcStreamServer.ts
async function serveGatewayRunStream(gateway, socket, args) {
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
}
var init_GatewayIpcStreamServer = __esm({
  "src/ipc/GatewayIpcStreamServer.ts"() {
    "use strict";
  }
});

// src/ipc/GatewayIpcServer.ts
var GatewayIpcServer_exports = {};
__export(GatewayIpcServer_exports, {
  createGatewayIpcServer: () => createGatewayIpcServer
});
import { chmod as chmod2, rm as rm4 } from "node:fs/promises";
import { createServer } from "node:net";
import { AiRuntimeError as AiRuntimeError11 } from "@agcomm/ai-runtime/gateway-host";
async function createGatewayIpcServer(gateway, root) {
  const secret = await gatewayIpcToken(root, true);
  const path = gatewayIpcEndpoint(root);
  if (process.platform !== "win32") await rm4(path, { force: true });
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
          if (request.token !== secret) throw new AiRuntimeError11("GATEWAY_AUTH_FAILED", "Gateway IPC authentication failed");
          if (request.operation === "watchRun") {
            await serveGatewayRunStream(gateway, socket, request.args ?? []);
            return;
          }
          socket.end(`${JSON.stringify({ ok: true, value: await dispatchGatewayIpc(gateway, request) })}
`);
        } catch (error) {
          if (!socket.destroyed) socket.end(`${JSON.stringify(gatewayIpcFailure(error))}
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
    await chmod2(path, 384);
  } catch {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    throw new AiRuntimeError11("GATEWAY_IPC_PERMISSIONS", "Unable to restrict Gateway IPC socket permissions");
  }
  return {
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose) => server.close(() => resolveClose()));
      if (process.platform !== "win32") await rm4(path, { force: true });
    }
  };
}
var init_GatewayIpcServer = __esm({
  "src/ipc/GatewayIpcServer.ts"() {
    "use strict";
    init_GatewayIpcAuth();
    init_GatewayIpcDispatcher();
    init_GatewayIpcStreamServer();
  }
});

// src/gateway/RuntimeGateway.ts
import { rm as rm5 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join6, resolve } from "node:path";
import { AiRuntimeError as AiRuntimeError12 } from "@agcomm/ai-runtime/gateway-host";

// src/gateway/GatewayLock.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, open, rm as rm2 } from "node:fs/promises";
import { join as join2 } from "node:path";
import { AiRuntimeError as AiRuntimeError3 } from "@agcomm/ai-runtime/gateway-host";

// src/gateway/GatewayState.ts
init_GatewayFilePermissions();
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AiRuntimeError as AiRuntimeError2 } from "@agcomm/ai-runtime/gateway-host";
var STREAM_RETENTION_MS = 7 * 24 * 60 * 6e4;
var MAX_STREAM_RUNS = 100;
var MAX_STREAM_BYTES = 4 * 1048576;
function gatewayAppId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new AiRuntimeError2("GATEWAY_APP_ID_INVALID", `Invalid Gateway app id: ${value}`);
  return value;
}
async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 448 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, { mode: 384 });
    await rename(temporary, path);
    await enforceGatewayPrivateMode(path, 384);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new AiRuntimeError2("GATEWAY_WRITE_FAILED", `Unable to write Gateway state: ${path}`, { cause: error });
  }
}
async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new AiRuntimeError2("GATEWAY_STATE_CORRUPT", `Gateway state is invalid: ${path}`, { cause: error });
  }
}
var GatewayState = class {
  constructor(root, now) {
    this.root = root;
    this.now = now;
  }
  root;
  now;
  registry = { version: 1, apps: [] };
  locks = /* @__PURE__ */ new Map();
  installHandler;
  bindInstall(handler) {
    this.installHandler = handler;
  }
  install(input, options = {}) {
    if (!this.installHandler) throw new AiRuntimeError2("GATEWAY_NOT_INITIALIZED", "Gateway install service is unavailable");
    return this.installHandler(input, options);
  }
  registryPath() {
    return join(this.root, "registry.json");
  }
  appDirectory(id) {
    return join(this.root, "apps", gatewayAppId(id));
  }
  statePath(id, name) {
    return join(this.root, "state", gatewayAppId(id), name);
  }
  streamDirectory(id) {
    return this.statePath(id, "streams");
  }
  streamPath(id, runId) {
    return join(this.streamDirectory(id), `${runId}.ndjson`);
  }
  app(id) {
    const item = this.registry.apps.find((app) => app.id === id);
    if (!item) throw new AiRuntimeError2("GATEWAY_APP_NOT_FOUND", `Gateway app was not found: ${id}`);
    return item;
  }
  async withLock(key, action) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.then(() => current);
    this.locks.set(key, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }
  async saveRegistry() {
    await atomicWrite(this.registryPath(), `${JSON.stringify(this.registry, null, 2)}
`);
  }
  async initialize() {
    await mkdir(join(this.root, "apps"), { recursive: true, mode: 448 });
    await mkdir(join(this.root, "state"), { recursive: true, mode: 448 });
    this.registry = await readJson(this.registryPath(), { version: 1, apps: [] });
    if (this.registry.version !== 1 || !Array.isArray(this.registry.apps)) throw new AiRuntimeError2("GATEWAY_STATE_CORRUPT", "Unsupported Gateway registry version");
  }
  async listApps() {
    return structuredClone(this.registry.apps).sort((a, b) => a.name.localeCompare(b.name));
  }
  async listRuns(id) {
    this.app(id);
    const runs = await readJson(this.statePath(id, "runs.json"), []);
    return runs.map((run) => ({ ...run, streamMode: run.streamMode ?? "text", lastSequence: run.lastSequence ?? 0, streamExpiresAt: run.streamExpiresAt ?? new Date(Date.parse(run.startedAt) + STREAM_RETENTION_MS).toISOString() }));
  }
  async writeRuns(id, runs) {
    await atomicWrite(this.statePath(id, "runs.json"), `${JSON.stringify(runs.slice(-1e3), null, 2)}
`);
  }
  async upsertRun(id, record) {
    await this.withLock(`${id}:runs`, async () => {
      const runs = await readJson(this.statePath(id, "runs.json"), []);
      const index = runs.findIndex((run) => run.id === record.id);
      if (index >= 0) runs[index] = structuredClone(record);
      else runs.push(structuredClone(record));
      await this.writeRuns(id, runs);
    });
  }
  async runRecord(id, runId) {
    const record = (await this.listRuns(id)).find((run) => run.id === runId);
    if (!record) throw new AiRuntimeError2("GATEWAY_RUN_NOT_FOUND", `Gateway run was not found: ${runId}`);
    return record;
  }
  async triggerSessions(id) {
    return readJson(this.statePath(id, "sessions.json"), {});
  }
  async saveTriggerSessions(id, sessions) {
    await atomicWrite(this.statePath(id, "sessions.json"), `${JSON.stringify(sessions, null, 2)}
`);
  }
};

// src/gateway/GatewayLock.ts
var GatewayLock = class {
  constructor(root, now) {
    this.root = root;
    this.now = now;
  }
  root;
  now;
  owner;
  async acquire() {
    const path = join2(this.root, "gateway.lock");
    await mkdir2(this.root, { recursive: true, mode: 448 });
    const owner = `${process.pid}:${randomUUID2()}`;
    const write = async () => {
      const handle = await open(path, "wx", 384);
      try {
        await handle.writeFile(`${JSON.stringify({ version: 1, owner, pid: process.pid, startedAt: this.now().toISOString() })}
`);
      } finally {
        await handle.close();
      }
    };
    try {
      await write();
    } catch (error) {
      if (error.code !== "EEXIST") throw new AiRuntimeError3("GATEWAY_LOCK_FAILED", "Unable to acquire Runtime Gateway process lock", { cause: error });
      const lock = await readJson(path, {});
      const liveness = await readJson(join2(this.root, "liveness.json"), {});
      const latest = Math.max(Date.parse(lock.startedAt ?? ""), Date.parse(liveness.at ?? ""));
      if (Number.isFinite(latest) && this.now().getTime() - latest < 9e4) throw new AiRuntimeError3("GATEWAY_ALREADY_RUNNING", "Another Runtime Gateway instance is active");
      await rm2(path, { force: true });
      try {
        await write();
      } catch (retryError) {
        throw new AiRuntimeError3("GATEWAY_ALREADY_RUNNING", "Another Runtime Gateway instance acquired the process lock", { cause: retryError });
      }
    }
    this.owner = owner;
  }
  async release() {
    if (!this.owner) return;
    const path = join2(this.root, "gateway.lock");
    try {
      if ((await readJson(path, {})).owner === this.owner) await rm2(path, { force: true });
    } finally {
      this.owner = void 0;
    }
  }
};

// ../shared/background-schedule.ts
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
function parseStep(source, part, field) {
  const step = source === void 0 ? 1 : Number(source);
  if (!Number.isInteger(step) || step < 1 || step > field.max - field.min + 1) {
    throw new Error(`Invalid Cron step: ${part}`);
  }
  return step;
}
function parseRange(source, part, field, step) {
  if (source === "*") return { start: field.min, end: field.max, step };
  const range = source.split("-");
  if (range.length > 2) throw new Error(`Invalid Cron range: ${part}`);
  const start = fieldValue(range[0], field);
  let end = range.length === 2 ? fieldValue(range[1], field) : start;
  if (field.sunday && range.length === 2 && range[1] === "7") end = 7;
  if (start > end) throw new Error(`Descending Cron range is not supported: ${part}`);
  return { start, end, step };
}
function parsePart(part, field) {
  if (!part) throw new Error("Cron field contains an empty list item");
  const [rangeSource, stepSource, extra] = part.split("/");
  if (extra !== void 0) throw new Error(`Invalid Cron step: ${part}`);
  return parseRange(rangeSource, part, field, parseStep(stepSource, part, field));
}
function addRange(values, range, field) {
  for (let value = range.start; value <= range.end; value += range.step) {
    values.add(field.sunday && value === 7 ? 0 : value);
  }
}
function parseField(source, field) {
  const values = /* @__PURE__ */ new Set();
  for (const part of source.split(",")) addRange(values, parsePart(part, field), field);
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
  return {
    minute: value("minute"),
    hour: value("hour"),
    day: value("day"),
    month: value("month"),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday ?? "")
  };
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

// src/gateway/GatewayScheduler.ts
var GatewayScheduler = class {
  triggers(background) {
    return [...background.heartbeat ? [background.heartbeat] : [], ...background.cron ?? []];
  }
  nextRun(trigger, after) {
    return "everyMs" in trigger ? new Date(after.getTime() + trigger.everyMs) : nextCronOccurrence(trigger.expression, trigger.timezone, after);
  }
};

// src/gateway/GatewayStream.ts
import { appendFile, mkdir as mkdir3, readFile as readFile2, readdir, rm as rm3 } from "node:fs/promises";
import { join as join3 } from "node:path";
import { AiRuntimeError as AiRuntimeError5 } from "@agcomm/ai-runtime/gateway-host";

// src/gateway/GatewayWatchService.ts
import { AiRuntimeError as AiRuntimeError4 } from "@agcomm/ai-runtime/gateway-host";
var finished = (record) => record.status === "completed" || record.status === "failed" || record.status === "cancelled";
function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve4, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve4();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function assertWatchable(record, mode, now) {
  if (Date.parse(record.streamExpiresAt) <= now.getTime() && finished(record)) throw new AiRuntimeError4("GATEWAY_STREAM_EXPIRED", `Gateway stream has expired: ${record.id}`);
  if (mode === "events" && record.streamMode !== "events") throw new AiRuntimeError4("GATEWAY_STREAM_MODE_UNAVAILABLE", "A text-only Gateway run cannot be replayed as full events");
}
var GatewayRunWatcher = class {
  constructor(port, appId, runId, initial, mode, signal, after = 0) {
    this.port = port;
    this.appId = appId;
    this.runId = runId;
    this.initial = initial;
    this.mode = mode;
    this.signal = signal;
    this.cursor = Math.max(0, Math.floor(after));
  }
  port;
  appId;
  runId;
  initial;
  mode;
  signal;
  cursor;
  consumed = false;
  projected(frames) {
    if (this.mode !== "text" || this.initial.streamMode !== "events") return frames;
    return frames.flatMap((frame) => {
      const event = frame.value;
      return event?.type === "output-delta" ? [{ sequence: frame.sequence, value: event.text }] : [];
    });
  }
  assertRetained(stored, frames, current) {
    if (!finished(current) || this.cursor >= current.lastSequence) return;
    if (!stored) throw new AiRuntimeError4("GATEWAY_STREAM_EXPIRED", `Gateway stream is no longer retained: ${this.runId}`);
    if (!frames.length) throw new AiRuntimeError4("GATEWAY_STREAM_INCOMPLETE", `Gateway stream log is incomplete: ${this.runId}`);
  }
  async *iterate() {
    if (this.consumed) throw new AiRuntimeError4("GATEWAY_STREAM_ALREADY_CONSUMED", "Gateway run stream only supports one consumer");
    this.consumed = true;
    for (; ; ) {
      const stored = await this.port.readFrames(this.appId, this.runId, this.cursor);
      const frames = stored ?? [];
      for (const frame of frames) this.cursor = Math.max(this.cursor, frame.sequence);
      for (const frame of this.projected(frames)) yield frame;
      const current = await this.port.runRecord(this.appId, this.runId);
      this.assertRetained(stored, frames, current);
      if (finished(current) && this.cursor >= current.lastSequence) return;
      await delay(50, this.signal);
    }
  }
};
async function watchGatewayRun(port, id, runId, options = {}) {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  const initial = await port.runRecord(id, runId);
  const mode = options.mode ?? initial.streamMode;
  assertWatchable(initial, mode, port.now());
  const watcher = new GatewayRunWatcher(port, id, runId, initial, mode, options.signal, options.afterSequence);
  return { runId, mode, get lastSequence() {
    return watcher.cursor;
  }, completion: port.waitForRun(id, runId), [Symbol.asyncIterator]: () => watcher.iterate() };
}

// src/gateway/GatewayStream.ts
var GatewayStream = class {
  constructor(state, now = () => /* @__PURE__ */ new Date()) {
    this.state = state;
    this.now = now;
  }
  state;
  now;
  states = /* @__PURE__ */ new Map();
  completions = /* @__PURE__ */ new Map();
  requireState() {
    if (!this.state) throw new AiRuntimeError5("GATEWAY_NOT_INITIALIZED", "Gateway stream state is unavailable");
    return this.state;
  }
  completion(runId) {
    const existing = this.completions.get(runId);
    if (existing) return existing;
    let resolve4;
    const promise = new Promise((done) => {
      resolve4 = done;
    });
    const created = { promise, resolve: resolve4 };
    this.completions.set(runId, created);
    return created;
  }
  complete(record) {
    this.completions.get(record.id)?.resolve(structuredClone(record));
    this.completions.delete(record.id);
    this.states.delete(record.id);
  }
  create(record, controller) {
    const state = { appId: record.appId, runId: record.id, mode: record.streamMode, sequence: 0, bytes: 0, tail: Promise.resolve(), controller };
    this.states.set(record.id, state);
    return state;
  }
  append(state, value) {
    const frame = { sequence: state.sequence + 1, value };
    const line = `${JSON.stringify(frame)}
`;
    const bytes = Buffer.byteLength(line, "utf8");
    if (state.bytes + bytes > MAX_STREAM_BYTES) {
      const error = new AiRuntimeError5("GATEWAY_STREAM_LIMIT_EXCEEDED", "Gateway stream log exceeds 4 MiB");
      state.controller.abort(error);
      throw error;
    }
    state.sequence = frame.sequence;
    state.bytes += bytes;
    const store = this.requireState();
    state.tail = state.tail.then(async () => {
      await mkdir3(store.streamDirectory(state.appId), { recursive: true, mode: 448 });
      await appendFile(store.streamPath(state.appId, state.runId), line, { encoding: "utf8", mode: 384 });
    }).catch((error) => {
      const failure = error instanceof AiRuntimeError5 ? error : new AiRuntimeError5("GATEWAY_WRITE_FAILED", "Unable to append Gateway stream log", { cause: error });
      state.controller.abort(failure);
      throw failure;
    });
    return frame;
  }
  async readFrames(id, runId, afterSequence) {
    const store = this.requireState();
    let text = "";
    try {
      text = await readFile2(store.streamPath(id, runId), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return void 0;
      throw new AiRuntimeError5("GATEWAY_STATE_CORRUPT", `Unable to read stream log for ${runId}`, { cause: error });
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
        throw new AiRuntimeError5("GATEWAY_STATE_CORRUPT", `Gateway stream log is invalid for ${runId}`, { cause: error });
      }
    }
    return frames.sort((a, b) => a.sequence - b.sequence);
  }
  async cleanup(id, existingRuns) {
    const store = this.requireState();
    const runs = existingRuns ?? await store.listRuns(id);
    const cutoff = this.now().getTime() - STREAM_RETENTION_MS;
    const keep = new Set([...runs].filter((run) => Date.parse(run.startedAt) >= cutoff).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MAX_STREAM_RUNS).map((run) => `${run.id}.ndjson`));
    let names = [];
    try {
      names = await readdir(store.streamDirectory(id));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await Promise.all(names.filter((name) => name.endsWith(".ndjson") && !keep.has(name)).map((name) => rm3(join3(store.streamDirectory(id), name), { force: true })));
  }
  watch(id, runId, options = {}) {
    const store = this.requireState();
    return watchGatewayRun({ now: this.now, runRecord: (appId, target) => store.runRecord(appId, target), waitForRun: async (appId, target) => {
      const record = await store.runRecord(appId, target);
      return ["completed", "failed", "cancelled"].includes(record.status) ? record : this.completion(target).promise;
    }, readFrames: (appId, target, after) => this.readFrames(appId, target, after) }, id, runId, options);
  }
};

// src/gateway/GatewayNotifier.ts
import { createHmac, randomUUID as randomUUID3 } from "node:crypto";
import { AiRuntimeError as AiRuntimeError7, createSafeOutboundFetch } from "@agcomm/ai-runtime/gateway-host";

// src/gateway/GatewayDeliveryService.ts
import { AiRuntimeError as AiRuntimeError6 } from "@agcomm/ai-runtime/gateway-host";
var RETRY_DELAYS = [6e4, 3e5, 18e5, 72e5];
var message = (error) => (error instanceof Error ? error.message : String(error)).slice(0, 4096);
async function deliverOne(port, app, delivery, notification, now, deliveries) {
  try {
    if (delivery.adapterId === "webhook") await port.deliverWebhook(app, notification, new AbortController().signal);
    else {
      const adapter = port.adapters.get(delivery.adapterId);
      if (!adapter) throw new AiRuntimeError6("NOTIFICATION_ADAPTER_NOT_FOUND", `Notification adapter is unavailable: ${delivery.adapterId}`);
      await adapter.deliver(notification, { app: structuredClone(app), signal: new AbortController().signal });
    }
    delivery.status = "delivered";
    notification.deliveryStatus = deliveries.some((item) => item.notificationId === notification.id && item !== delivery && item.status !== "delivered") ? "queued" : "delivered";
    delete delivery.lastError;
  } catch (error) {
    delivery.lastError = message(error);
    const delay2 = RETRY_DELAYS[delivery.attempts++];
    if (delay2 === void 0) {
      delivery.status = "failed";
      notification.deliveryStatus = "failed";
    } else delivery.nextAttemptAt = new Date(now.getTime() + delay2).toISOString();
  }
  notification.updatedAt = now.toISOString();
}
async function deliverPendingNotifications(port) {
  const now = port.now();
  for (const app of port.apps) await port.withLock(`${app.id}:notifications`, async () => {
    const deliveries = await readJson(port.statePath(app.id, "deliveries.json"), []);
    const inbox = await readJson(port.statePath(app.id, "inbox.json"), []);
    let changed = false;
    for (const delivery of deliveries.filter((item) => item.status === "queued" && new Date(item.nextAttemptAt) <= now)) {
      const notification = inbox.find((item) => item.id === delivery.notificationId);
      if (!notification) {
        delivery.status = "failed";
        delivery.lastError = "Inbox item was removed";
        changed = true;
        continue;
      }
      await deliverOne(port, app, delivery, notification, now, deliveries);
      changed = true;
    }
    if (changed) {
      await atomicWrite(port.statePath(app.id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}
`);
      await atomicWrite(port.statePath(app.id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}
`);
    }
  });
}

// src/gateway/GatewayNotifier.ts
var MAX_INBOX = 1e4;
var INBOX_RETENTION_MS = 90 * 24 * 60 * 6e4;
function createGatewayCredentialStore() {
  const entry = async (id) => {
    try {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      return new AsyncEntry("io.agcomm.runtime.gateway.webhook", gatewayAppId(id));
    } catch (error) {
      throw new AiRuntimeError7("NATIVE_CREDENTIAL_UNAVAILABLE", "Gateway webhook credential storage is unavailable", { cause: error });
    }
  };
  return { async get(id) {
    try {
      return await (await entry(id)).getPassword();
    } catch (error) {
      throw new AiRuntimeError7("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to read Gateway webhook secret", { cause: error });
    }
  }, async set(id, secret) {
    try {
      await (await entry(id)).setPassword(secret);
    } catch (error) {
      throw new AiRuntimeError7("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to save Gateway webhook secret", { cause: error });
    }
  }, async delete(id) {
    try {
      await (await entry(id)).deleteCredential();
    } catch (error) {
      throw new AiRuntimeError7("NATIVE_CREDENTIAL_UNAVAILABLE", "Unable to delete Gateway webhook secret", { cause: error });
    }
  } };
}
var GatewayNotifier = class {
  constructor(credentials, adapters, state, now = () => /* @__PURE__ */ new Date(), fetcher) {
    this.credentials = credentials;
    this.state = state;
    this.now = now;
    this.fetcher = fetcher;
    for (const adapter of adapters) {
      if (!adapter.id || this.adapters.has(adapter.id) || adapter.id === "webhook") throw new AiRuntimeError7("NOTIFICATION_ADAPTER_INVALID", `Invalid or duplicate notification adapter: ${adapter.id}`);
      this.adapters.set(adapter.id, adapter);
    }
  }
  credentials;
  state;
  now;
  fetcher;
  adapters = /* @__PURE__ */ new Map();
  requireState() {
    if (!this.state) throw new AiRuntimeError7("GATEWAY_NOT_INITIALIZED", "Gateway notification state is unavailable");
    return this.state;
  }
  async listInbox(id) {
    const state = this.requireState();
    state.app(id);
    return readJson(state.statePath(id, "inbox.json"), []);
  }
  async markRead(id, notificationIds) {
    const state = this.requireState();
    state.app(id);
    await state.withLock(`${id}:notifications`, async () => {
      const set = new Set(notificationIds);
      const inbox = await readJson(state.statePath(id, "inbox.json"), []);
      const at = this.now().toISOString();
      for (const item of inbox) if (set.has(item.id)) item.readAt = at;
      await atomicWrite(state.statePath(id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}
`);
    });
  }
  async retry(id, notificationId) {
    const state = this.requireState();
    state.app(id);
    await state.withLock(`${id}:notifications`, async () => {
      const deliveries = await readJson(state.statePath(id, "deliveries.json"), []);
      const delivery = deliveries.find((item) => item.notificationId === notificationId && item.status === "failed");
      if (!delivery) throw new AiRuntimeError7("GATEWAY_DELIVERY_NOT_FOUND", `Failed delivery was not found: ${notificationId}`);
      Object.assign(delivery, { status: "queued", attempts: 0, nextAttemptAt: this.now().toISOString() });
      delete delivery.lastError;
      await atomicWrite(state.statePath(id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}
`);
    });
  }
  async recordContact(app, request) {
    const state = this.requireState();
    return state.withLock(`${app.id}:notifications`, async () => {
      const now = this.now();
      let inbox = (await readJson(state.statePath(app.id, "inbox.json"), [])).filter((item2) => now.getTime() - new Date(item2.updatedAt).getTime() <= INBOX_RETENTION_MS);
      const duplicate = request.dedupeKey ? inbox.find((item2) => item2.dedupeKey === request.dedupeKey && now.getTime() - new Date(item2.updatedAt).getTime() < 864e5) : void 0;
      if (duplicate) return { id: duplicate.id, status: "queued", webhookQueued: duplicate.deliveryStatus === "queued", createdAt: duplicate.createdAt };
      const adapterIds = [...app.notificationAdapters, ...request.webhook ? ["webhook"] : []];
      const item = { id: randomUUID3(), appId: app.id, packageHash: app.packageHash, nodeId: request.nodeId, triggerId: request.trigger.id, runId: request.trigger.runId, title: request.title, body: request.body, severity: request.severity, ...request.dedupeKey ? { dedupeKey: request.dedupeKey } : {}, createdAt: now.toISOString(), updatedAt: now.toISOString(), deliveryStatus: adapterIds.length ? "queued" : "none" };
      inbox.push(item);
      if (inbox.length > MAX_INBOX) inbox = inbox.slice(-MAX_INBOX);
      await atomicWrite(state.statePath(app.id, "inbox.json"), `${JSON.stringify(inbox, null, 2)}
`);
      if (adapterIds.length) {
        const deliveries = await readJson(state.statePath(app.id, "deliveries.json"), []);
        for (const adapterId of new Set(adapterIds)) deliveries.push({ id: randomUUID3(), notificationId: item.id, adapterId, attempts: 0, nextAttemptAt: now.toISOString(), status: "queued" });
        await atomicWrite(state.statePath(app.id, "deliveries.json"), `${JSON.stringify(deliveries, null, 2)}
`);
      }
      return { id: item.id, status: "queued", webhookQueued: request.webhook, createdAt: item.createdAt };
    });
  }
  async deliverWebhook(app, item, signal) {
    if (!app.webhookUrl) throw new AiRuntimeError7("GATEWAY_WEBHOOK_REQUIRED", `Webhook URL is missing for ${app.id}`);
    const secret = await this.credentials.get(app.id);
    if (!secret) throw new AiRuntimeError7("GATEWAY_WEBHOOK_REQUIRED", `Webhook secret is missing for ${app.id}`);
    const payload = JSON.stringify({ id: item.id, appId: item.appId, packageHash: item.packageHash, triggerId: item.triggerId, runId: item.runId, title: item.title, body: item.body, severity: item.severity, createdAt: item.createdAt });
    const timestamp = String(Math.floor(this.now().getTime() / 1e3));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    const response = await createSafeOutboundFetch({ maxRedirects: 0, maxResponseBytes: 65536, signal, fetcher: this.fetcher })(app.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-agcomm-event": item.id, "x-agcomm-timestamp": timestamp, "x-agcomm-signature": `sha256=${signature}` }, body: payload });
    if (!response.ok) throw new AiRuntimeError7("GATEWAY_WEBHOOK_FAILED", `Webhook returned HTTP ${response.status}`);
  }
  async deliverPending() {
    const state = this.requireState();
    return deliverPendingNotifications({ apps: state.registry.apps, adapters: this.adapters, now: this.now, statePath: (id, name) => state.statePath(id, name), withLock: (key, action) => state.withLock(key, action), deliverWebhook: (app, item, signal) => this.deliverWebhook(app, item, signal) });
  }
};

// src/gateway/GatewayInstaller.ts
import { createHash } from "node:crypto";
import { mkdir as mkdir4, readFile as readFile3 } from "node:fs/promises";
import { join as join4 } from "node:path";
import { AiRuntimeError as AiRuntimeError8, inspectGatewayPackage, validateResolvedPublicUrl } from "@agcomm/ai-runtime/gateway-host";
function validateWebhook(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new AiRuntimeError8("GATEWAY_WEBHOOK_INVALID", "Webhook URL must be credential-free HTTPS without a query or fragment");
  return validateResolvedPublicUrl(url, { signal: new AbortController().signal }).catch((error) => {
    throw new AiRuntimeError8("GATEWAY_WEBHOOK_INVALID", "Webhook URL must resolve to a public HTTPS endpoint", { cause: error });
  });
}
async function installGatewayApplication(port, pathOrBytes, install = {}) {
  const bytes = typeof pathOrBytes === "string" ? new Uint8Array(await readFile3(pathOrBytes)) : new Uint8Array(pathOrBytes);
  const inspected = await inspectGatewayPackage(bytes, port.runtime);
  const id = gatewayAppId(inspected.appId);
  const existing = port.registry.apps.find((app) => app.id === id);
  const webhookUrl = install.webhook?.url ?? existing?.webhookUrl;
  if (inspected.requiresWebhook && !webhookUrl) throw new AiRuntimeError8("GATEWAY_WEBHOOK_REQUIRED", `App ${id} requires a Webhook URL`);
  if (webhookUrl) await validateWebhook(webhookUrl);
  if (install.webhook?.secret !== void 0) {
    if (install.webhook.secret.length < 16 || install.webhook.secret.length > 512) throw new AiRuntimeError8("GATEWAY_WEBHOOK_SECRET_INVALID", "Webhook signing secret must contain 16\u2013512 characters");
    await port.saveCredential(id, install.webhook.secret);
  } else if (inspected.requiresWebhook && !await port.credential(id)) throw new AiRuntimeError8("GATEWAY_WEBHOOK_REQUIRED", `App ${id} requires a Webhook signing secret`);
  const configuredAdapters = [...new Set(install.notificationAdapters ?? existing?.notificationAdapters ?? [])];
  for (const adapter of configuredAdapters) if (!port.adapters.has(adapter)) throw new AiRuntimeError8("NOTIFICATION_ADAPTER_NOT_FOUND", `Notification adapter is not registered: ${adapter}`);
  const packageHash = createHash("sha256").update(bytes).digest("hex");
  if (packageHash !== inspected.packageHash) throw new AiRuntimeError8("GATEWAY_PACKAGE_INVALID", "Runtime package hash does not match the installed bytes");
  if (existing && existing.packageHash !== packageHash) {
    await port.stopActive(id, "Gateway app package was replaced");
    await port.cancelPending(id, "Gateway app package was replaced");
  }
  const appDirectory = join4(port.root, "apps", id);
  await mkdir4(appDirectory, { recursive: true, mode: 448 });
  await atomicWrite(join4(appDirectory, "app.ai"), bytes);
  const now = port.now();
  const nextRuns = {};
  for (const trigger of port.triggers(inspected.background)) nextRuns[trigger.id] = (trigger.everyMs && trigger.runOnStart ? now : port.nextRun(trigger, now)).toISOString();
  const record = {
    id,
    name: inspected.name,
    version: inspected.version,
    packageHash,
    enabled: install.enabled !== false,
    installedAt: existing?.installedAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    background: structuredClone(inspected.background),
    requiresWebhook: inspected.requiresWebhook,
    ...webhookUrl ? { webhookUrl } : {},
    notificationAdapters: configuredAdapters,
    nextRuns,
    defaultStreamMode: inspected.defaultStreamMode
  };
  port.registry.apps = [...port.registry.apps.filter((app) => app.id !== id), record];
  if (existing?.packageHash !== packageHash) await atomicWrite(port.statePath(id, "sessions.json"), "{}\n");
  await port.saveRegistry();
  return structuredClone(record);
}

// src/gateway/RuntimeGateway.ts
function defaultRoot() {
  return join6(homedir2(), ".agcomm", "runtime", "gateway");
}
var RuntimeGateway = class {
  constructor(options = {}, executor) {
    this.options = options;
    this.root = resolve(options.root ?? defaultRoot());
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.state = new GatewayState(this.root, this.now);
    this.notifier = new GatewayNotifier(options.credentialStore ?? createGatewayCredentialStore(), options.notificationAdapters ?? [], this.state, this.now, options.fetcher);
    this.stream = new GatewayStream(this.state, this.now);
    this.instanceLock = new GatewayLock(this.root, this.now);
    this.executor = executor;
    this.executor.configure({ state: this.state, stream: this.stream, notifier: this.notifier, runtime: options.runtime, now: this.now });
    this.state.bindInstall((input, install) => installGatewayApplication({ root: this.root, runtime: this.options.runtime, registry: this.state.registry, adapters: this.notifier.adapters, now: this.now, credential: (id) => this.notifier.credentials.get(id), saveCredential: (id, secret) => this.notifier.credentials.set(id, secret), stopActive: (id, reason) => this.executor.stopActive(id, reason), cancelPending: (id, reason) => this.executor.cancelPending(id, reason), triggers: (background) => this.scheduler.triggers(background), nextRun: (trigger, after) => this.scheduler.nextRun(trigger, after), saveRegistry: () => this.state.saveRegistry(), statePath: (id, name) => this.state.statePath(id, name) }, input, install));
  }
  options;
  root;
  now;
  timer;
  ipc;
  ticking = false;
  instanceLock;
  scheduler = new GatewayScheduler();
  state;
  stream;
  executor;
  notifier;
  async initialize() {
    await this.state.initialize();
    const now = this.now();
    for (const app of this.state.registry.apps) {
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
      if (changed) await this.state.writeRuns(app.id, runs);
      await this.stream.cleanup(app.id, runs);
    }
    await this.state.saveRegistry();
    return this;
  }
  async status() {
    const liveness = await readJson(join6(this.root, "liveness.json"), {});
    const heartbeatAt = typeof liveness.at === "string" ? liveness.at : void 0;
    const healthy = Boolean(heartbeatAt && this.now().getTime() - Date.parse(heartbeatAt) <= 9e4);
    return { alive: true, pid: liveness.pid ?? process.pid, heartbeatAt, healthy };
  }
  install(pathOrBytes, install = {}) {
    return this.state.install(pathOrBytes, install);
  }
  async enable(id) {
    const app = this.state.app(id);
    app.enabled = true;
    app.updatedAt = this.now().toISOString();
    for (const trigger of this.scheduler.triggers(app.background)) app.nextRuns[trigger.id] = this.scheduler.nextRun(trigger, this.now()).toISOString();
    await this.state.saveRegistry();
  }
  async disable(id) {
    const app = this.state.app(id);
    app.enabled = false;
    app.updatedAt = this.now().toISOString();
    await this.executor.stopActive(id, "Gateway app disabled");
    await this.executor.cancelPending(id, "Gateway app is disabled");
    await this.state.saveRegistry();
  }
  async uninstall(id) {
    this.state.app(id);
    await this.executor.stopActive(id, "Gateway app uninstalled");
    await this.executor.cancelPending(id, "Gateway app was uninstalled");
    this.state.registry.apps = this.state.registry.apps.filter((app) => app.id !== id);
    await this.state.saveRegistry();
    await this.notifier.credentials.delete(id);
    await rm5(this.state.appDirectory(id), { recursive: true, force: true });
  }
  async listApps() {
    return this.state.listApps();
  }
  async listRuns(id) {
    return this.state.listRuns(id);
  }
  async listInbox(id) {
    return this.notifier.listInbox(id);
  }
  async markInboxRead(id, notificationIds) {
    return this.notifier.markRead(id, notificationIds);
  }
  async retryDelivery(id, notificationId) {
    return this.notifier.retry(id, notificationId);
  }
  async startRunNow(id, triggerId, options = {}) {
    const app = this.state.app(id);
    const trigger = this.scheduler.triggers(app.background).find((item) => item.id === triggerId);
    if (!trigger) throw new AiRuntimeError12("GATEWAY_TRIGGER_NOT_FOUND", `Trigger was not found: ${triggerId}`);
    const mode = options.mode ?? app.defaultStreamMode ?? "text";
    if (mode !== "text" && mode !== "events") throw new AiRuntimeError12("GATEWAY_STREAM_MODE_INVALID", `Unsupported stream mode: ${mode}`);
    return this.executor.start(app, trigger, this.now(), mode);
  }
  watchRun(id, runId, options = {}) {
    return this.stream.watch(id, runId, options);
  }
  async runNow(id, triggerId) {
    const ticket = await this.startRunNow(id, triggerId);
    const record = await this.state.runRecord(id, ticket.runId);
    if (record.status === "queued" || record.status === "running") await this.stream.completion(ticket.runId).promise;
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      await atomicWrite(join6(this.root, "liveness.json"), `${JSON.stringify({ version: 1, pid: process.pid, at: now.toISOString() })}
`);
      await this.notifier.deliverPending();
      for (const app of this.state.registry.apps) await this.stream.cleanup(app.id);
      for (const app of this.state.registry.apps.filter((item) => item.enabled)) for (const trigger of this.scheduler.triggers(app.background)) {
        const scheduledAt = new Date(app.nextRuns[trigger.id] ?? this.scheduler.nextRun(trigger, now).toISOString());
        if (scheduledAt > now) continue;
        app.nextRuns[trigger.id] = this.scheduler.nextRun(trigger, now).toISOString();
        if ("expression" in trigger && now.getTime() - scheduledAt.getTime() > (trigger.misfireGraceMs ?? 9e5)) continue;
        void this.executor.start(app, trigger, scheduledAt, app.defaultStreamMode ?? "text").catch(() => {
        });
      }
      await this.state.saveRegistry();
    } finally {
      this.ticking = false;
    }
  }
  async start() {
    if (this.timer) return;
    await this.instanceLock.acquire();
    try {
      await this.initialize();
      const { createGatewayIpcServer: createGatewayIpcServer2 } = await Promise.resolve().then(() => (init_GatewayIpcServer(), GatewayIpcServer_exports));
      this.ipc = await createGatewayIpcServer2(this, this.root);
      await this.tick();
      this.timer = setInterval(() => {
        void this.tick();
      }, 3e4);
      this.timer.unref?.();
    } catch (error) {
      await this.instanceLock.release();
      throw error;
    }
  }
  async dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = void 0;
    await this.ipc?.close();
    this.ipc = void 0;
    for (const id of [...this.executor.pending.keys()]) await this.executor.cancelPending(id, "Gateway disposed");
    const running = [...this.executor.activeRunIds.values()].map((runId) => this.stream.completion(runId).promise);
    for (const controller of this.executor.active.values()) controller.abort(new DOMException("Gateway disposed", "AbortError"));
    await Promise.all(running);
    await this.instanceLock.release();
  }
};

// src/gateway/GatewayExecutor.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { rm as rm6 } from "node:fs/promises";
import { join as join7 } from "node:path";
import { AiRuntimeError as AiRuntimeError13, executeGatewayTrigger } from "@agcomm/ai-runtime/gateway-host";
var errorText = (error) => (error instanceof Error ? error.message : String(error)).slice(0, 4096);
var summary = (value, limit = 4096) => (typeof value === "string" ? value : JSON.stringify(value ?? null)).slice(0, limit);
var GatewayExecutor = class {
  active = /* @__PURE__ */ new Map();
  activeRunIds = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  services;
  configure(services) {
    this.services = services;
  }
  service() {
    if (!this.services) throw new AiRuntimeError13("GATEWAY_NOT_INITIALIZED", "Gateway executor is unavailable");
    return this.services;
  }
  activeFor(app) {
    return this.active.has(app.id);
  }
  queue(app, pending) {
    const queue = this.pending.get(app.id) ?? /* @__PURE__ */ new Map();
    const existing = queue.get(pending.trigger.id);
    if (!existing) {
      queue.set(pending.trigger.id, pending);
      this.pending.set(app.id, queue);
    }
    return existing;
  }
  release(record) {
    this.active.delete(record.appId);
    this.activeRunIds.delete(record.appId);
  }
  next(appId) {
    const queue = this.pending.get(appId);
    const next = queue?.values().next().value;
    if (next) {
      queue.delete(next.trigger.id);
      if (!queue.size) this.pending.delete(appId);
    }
    return next;
  }
  completion(runId) {
    return this.service().stream.completion(runId);
  }
  baseRecord(app, trigger, scheduledAt, runId, mode, status) {
    const now = this.service().now();
    return { id: runId, appId: app.id, packageHash: app.packageHash, triggerId: trigger.id, triggerType: "everyMs" in trigger ? "heartbeat" : "cron", scheduledAt: scheduledAt.toISOString(), startedAt: now.toISOString(), status, streamMode: mode, lastSequence: 0, streamExpiresAt: new Date(now.getTime() + STREAM_RETENTION_MS).toISOString() };
  }
  async cancelPending(id, reason) {
    const { state, stream, now } = this.service();
    const queued = this.pending.get(id);
    this.pending.delete(id);
    if (!queued?.size) return;
    const at = now();
    for (const pending of queued.values()) {
      const record = await state.runRecord(id, pending.runId);
      Object.assign(record, { status: "cancelled", finishedAt: at.toISOString(), elapsedMs: Math.max(0, at.getTime() - Date.parse(record.startedAt)), error: reason });
      await state.upsertRun(id, record);
      stream.complete(record);
    }
  }
  async stopActive(id, reason) {
    const controller = this.active.get(id);
    const runId = this.activeRunIds.get(id);
    if (!controller || !runId) return;
    controller.abort(new DOMException(reason, "AbortError"));
    await this.completion(runId).promise;
  }
  async start(app, trigger, scheduledAt, mode) {
    const { state } = this.service();
    if (this.active.has(app.id)) {
      const runId2 = randomUUID4();
      const existing = this.queue(app, { runId: runId2, trigger, scheduledAt, mode });
      if (existing) return { runId: existing.runId, status: "queued", coalesced: true };
      this.completion(runId2);
      await state.upsertRun(app.id, this.baseRecord(app, trigger, scheduledAt, runId2, mode, "queued"));
      return { runId: runId2, status: "queued", coalesced: false };
    }
    const controller = new AbortController();
    const runId = randomUUID4();
    this.completion(runId);
    const record = this.baseRecord(app, trigger, scheduledAt, runId, mode, "running");
    this.active.set(app.id, controller);
    try {
      await state.upsertRun(app.id, record);
    } catch (error) {
      this.active.delete(app.id);
      throw error;
    }
    this.activeRunIds.set(app.id, runId);
    this.launch(app, trigger, scheduledAt, record, controller);
    return { runId, status: "running", coalesced: false };
  }
  previous(runs, triggerId) {
    const run = [...runs].reverse().find((item) => item.triggerId === triggerId && (item.status === "completed" || item.status === "failed") && item.finishedAt);
    return run ? { status: run.status, finishedAt: run.finishedAt, ...run.outputSummary ? { outputSummary: run.outputSummary } : {} } : void 0;
  }
  launch(app, trigger, scheduledAt, record, controller) {
    void this.execute(app, trigger, scheduledAt, record, controller).catch((error) => this.failLaunch(app, record, controller, error));
  }
  async failLaunch(app, record, controller, error) {
    const { state, stream, now } = this.service();
    if (this.active.get(app.id) === controller) this.release(record);
    const current = await state.runRecord(app.id, record.id).catch(() => record);
    if (current.status !== "queued" && current.status !== "running") return;
    const reason = controller.signal.aborted ? controller.signal.reason ?? error : error;
    Object.assign(current, { status: reason instanceof DOMException && reason.name === "AbortError" ? "cancelled" : "failed", error: errorText(reason), finishedAt: now().toISOString(), elapsedMs: Math.max(0, now().getTime() - Date.parse(current.startedAt)) });
    await state.upsertRun(app.id, current).catch(() => {
    });
    stream.complete(current);
  }
  async execute(app, trigger, scheduledAt, record, controller) {
    const { state, stream, notifier, runtime, now } = this.service();
    const started = now();
    Object.assign(record, { status: "running", startedAt: started.toISOString() });
    await state.upsertRun(app.id, record);
    const runs = await state.listRuns(app.id);
    const previous = this.previous(runs, trigger.id);
    const context = { type: "everyMs" in trigger ? "heartbeat" : "cron", id: trigger.id, scheduledAt: scheduledAt.toISOString(), firedAt: started.toISOString(), appId: app.id, packageHash: app.packageHash, runId: record.id, attempt: 1, ...previous ? { previous } : {} };
    await rm6(state.streamPath(app.id, record.id), { force: true });
    const streamState = stream.create(record, controller);
    try {
      const sessions = await state.triggerSessions(app.id);
      const session = sessions[trigger.id]?.packageHash === app.packageHash ? sessions[trigger.id] : { messages: [], packageHash: app.packageHash };
      const result = await executeGatewayTrigger(join7(state.appDirectory(app.id), "app.ai"), runtime, { input: trigger.input, variables: trigger.variables, signal: controller.signal, renderer: false, mode: record.streamMode, ...record.streamMode === "events" ? { onStreamEvent: (event) => {
        stream.append(streamState, event);
      } } : { onOutputDelta: (text) => {
        stream.append(streamState, text);
      } } }, { trigger: context, history: session.messages, contact: (request) => notifier.recordContact(app, request) });
      await streamState.tail;
      session.messages.push({ role: "user", content: trigger.input }, { role: "assistant", content: summary(result.output, 64e3) });
      session.messages = session.messages.slice(-(app.background.historyWindow ?? 20));
      sessions[trigger.id] = session;
      await state.saveTriggerSessions(app.id, sessions);
      record.status = "completed";
      record.outputSummary = summary(result.output);
    } catch (error) {
      try {
        await streamState.tail;
      } catch (streamError) {
        error = streamError;
      }
      const reason = controller.signal.aborted ? controller.signal.reason ?? error : error;
      record.status = reason instanceof DOMException && reason.name === "AbortError" ? "cancelled" : "failed";
      record.error = errorText(reason);
    }
    record.lastSequence = streamState.sequence;
    record.finishedAt = now().toISOString();
    record.elapsedMs = now().getTime() - started.getTime();
    await state.upsertRun(app.id, record);
    if (this.active.get(app.id) === controller) this.release(record);
    stream.complete(record);
    await stream.cleanup(app.id);
    await this.launchNext(app.id);
  }
  async launchNext(appId) {
    const { state, stream, now } = this.service();
    const next = this.next(appId);
    if (!next) return;
    const app = state.registry.apps.find((item) => item.id === appId && item.enabled);
    if (app) {
      const controller = new AbortController();
      this.active.set(appId, controller);
      this.activeRunIds.set(appId, next.runId);
      this.launch(app, next.trigger, next.scheduledAt, await state.runRecord(appId, next.runId), controller);
      return;
    }
    const cancelled = await state.runRecord(appId, next.runId);
    Object.assign(cancelled, { status: "cancelled", finishedAt: now().toISOString(), elapsedMs: 0, error: "Gateway app is disabled" });
    await state.upsertRun(appId, cancelled);
    stream.complete(cancelled);
  }
};

// src/gateway/GatewayComposition.ts
function createRuntimeGateway(options = {}) {
  return new RuntimeGateway(options, new GatewayExecutor());
}

// src/ipc/GatewayIpcClient.ts
init_GatewayIpcAuth();
import { resolve as resolve2 } from "node:path";
import { createConnection as createConnection2 } from "node:net";
import { AiRuntimeError as AiRuntimeError15 } from "@agcomm/ai-runtime/gateway-host";

// src/ipc/GatewayIpcRunStream.ts
init_GatewayIpcAuth();
import { createConnection } from "node:net";

// src/ipc/GatewayRunStreamConnection.ts
import { AiRuntimeError as AiRuntimeError14 } from "@agcomm/ai-runtime/gateway-host";
var GatewayRunStreamConnection = class {
  constructor(socket, afterSequence, resolveStream, rejectStream) {
    this.socket = socket;
    this.resolveStream = resolveStream;
    this.rejectStream = rejectStream;
    this.cursor = Math.max(0, Math.floor(afterSequence ?? 0));
    void this.completion.catch(() => {
    });
  }
  socket;
  resolveStream;
  rejectStream;
  buffer = "";
  acknowledged = false;
  consumed = false;
  closed = false;
  cursor;
  queue = [];
  wake;
  terminalError;
  resolveCompletion;
  rejectCompletion;
  completion = new Promise((resolve4, reject) => {
    this.resolveCompletion = resolve4;
    this.rejectCompletion = reject;
  });
  notify() {
    const current = this.wake;
    this.wake = void 0;
    current?.();
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    this.terminalError = error instanceof AiRuntimeError14 || error instanceof DOMException ? error : new AiRuntimeError14("GATEWAY_UNAVAILABLE", "Gateway stream connection failed", { cause: error });
    this.rejectCompletion(this.terminalError);
    this.notify();
    if (!this.acknowledged) this.rejectStream(this.terminalError);
  }
  closeUnexpectedly() {
    if (!this.closed) this.fail(new AiRuntimeError14("GATEWAY_STREAM_CLOSED", "Gateway stream closed before completion"));
  }
  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 5 * 1048576) return this.destroy(new AiRuntimeError14("GATEWAY_RESPONSE_INVALID", "Gateway stream frame exceeds the IPC limit"));
    for (; ; ) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.parse(line);
    }
  }
  parse(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch (error) {
      return this.destroy(new AiRuntimeError14("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned an invalid stream response", { cause: error }));
    }
    this.accept(response);
  }
  accept(response) {
    if ("ok" in response) return this.acknowledge(response);
    if ("stream" in response) {
      if (!this.acknowledged) return this.destroy(new AiRuntimeError14("GATEWAY_RESPONSE_INVALID", "Gateway sent a stream frame before acknowledgement"));
      this.queue.push(response.frame);
      this.notify();
      return;
    }
    if (!this.acknowledged) return this.destroy(new AiRuntimeError14("GATEWAY_RESPONSE_INVALID", "Gateway completed a stream before acknowledgement"));
    this.closed = true;
    this.resolveCompletion(response.record);
    this.notify();
    this.socket.end();
  }
  acknowledge(response) {
    if (!response.ok) return this.destroy(new AiRuntimeError14(response.error.code, response.error.message));
    if (this.acknowledged) return this.destroy(new AiRuntimeError14("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned duplicate stream acknowledgement"));
    this.acknowledged = true;
    const value = response.value;
    this.resolveStream(this.createStream(value.runId, value.mode));
  }
  createStream(runId, mode) {
    const self = this;
    return { runId, mode, get lastSequence() {
      return self.cursor;
    }, completion: this.completion, async *[Symbol.asyncIterator]() {
      if (self.consumed) throw new AiRuntimeError14("GATEWAY_STREAM_ALREADY_CONSUMED", "Gateway run stream only supports one consumer");
      self.consumed = true;
      try {
        for (; ; ) {
          while (self.queue.length) {
            const frame = self.queue.shift();
            self.cursor = Math.max(self.cursor, frame.sequence);
            yield frame;
          }
          if (self.closed) {
            if (self.terminalError) throw self.terminalError;
            return;
          }
          await new Promise((resolve4) => {
            self.wake = resolve4;
          });
        }
      } finally {
        if (!self.closed) self.destroy(new DOMException("Gateway stream consumer stopped", "AbortError"));
      }
    } };
  }
  destroy(error) {
    this.fail(error);
    this.socket.destroy();
  }
};

// src/ipc/GatewayIpcRunStream.ts
function connectGatewayRunStream(root, secret, id, runId, watch = {}) {
  return new Promise((resolveStream, rejectStream) => {
    if (watch.signal?.aborted) {
      rejectStream(watch.signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const socket = createConnection(gatewayIpcEndpoint(root));
    socket.setEncoding("utf8");
    const connection = new GatewayRunStreamConnection(socket, watch.afterSequence, resolveStream, rejectStream);
    const abort = () => {
      const reason = watch.signal?.reason ?? new DOMException("Aborted", "AbortError");
      connection.fail(reason);
      socket.destroy();
    };
    watch.signal?.addEventListener("abort", abort, { once: true });
    socket.once("error", (error) => connection.fail(error));
    socket.once("close", () => {
      watch.signal?.removeEventListener("abort", abort);
      connection.closeUnexpectedly();
    });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({
        token: secret,
        operation: "watchRun",
        args: [id, runId, { mode: watch.mode, afterSequence: watch.afterSequence }]
      })}
`);
    });
    socket.on("data", (chunk) => connection.onData(String(chunk)));
  });
}

// src/ipc/GatewayIpcClient.ts
async function connectRuntimeGateway(options = {}) {
  const root = resolve2(options.root ?? defaultGatewayRoot());
  const secret = await gatewayIpcToken(root, false);
  const call = (operation, args = []) => new Promise((resolveCall, reject) => {
    const socket = createConnection2(gatewayIpcEndpoint(root));
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };
    socket.once("error", (error) => finish(() => reject(new AiRuntimeError15("GATEWAY_UNAVAILABLE", "Runtime Gateway is not running", { cause: error }))));
    socket.setTimeout(1e4, () => finish(() => reject(new AiRuntimeError15("GATEWAY_UNAVAILABLE", "Runtime Gateway did not respond within 10 seconds"))));
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: secret, operation, args })}
`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response.ok) finish(() => reject(new AiRuntimeError15(response.error.code, response.error.message)));
        else finish(() => resolveCall(response.value));
      } catch (error) {
        finish(() => reject(new AiRuntimeError15("GATEWAY_RESPONSE_INVALID", "Runtime Gateway returned an invalid response", { cause: error })));
      }
    });
  });
  const watchRun = (id, runId, watch = {}) => connectGatewayRunStream(root, secret, id, runId, watch);
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

// src/gateway-service.ts
import { execFile } from "node:child_process";
import { mkdir as mkdir6, rm as rm7, writeFile as writeFile3 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname2, join as join8, resolve as resolve3 } from "node:path";
import { promisify } from "node:util";
import { AiRuntimeError as AiRuntimeError16 } from "@agcomm/ai-runtime/gateway-host";
var execute = promisify(execFile);
var SERVICE_NAME = "io.agcomm.runtime.gateway";
function paths(options) {
  const cliPath = resolve3(options.cliPath ?? process.argv[1] ?? "");
  const nodePath = resolve3(options.nodePath ?? process.execPath);
  const home = resolve3(options.homeDir ?? homedir3());
  if (!cliPath || /(?:^|[/\\])(?:_npx|npm-cache|Temp|tmp)(?:[/\\])/i.test(cliPath)) {
    throw new AiRuntimeError16("GATEWAY_RUNTIME_PATH_UNSTABLE", "Gateway login service requires @agcomm/ai-runtime to be installed at a stable path");
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
    throw new AiRuntimeError16(code, `Unable to configure Runtime Gateway login service using ${file}`, { cause: error });
  }
}
async function ignoreMissingService(action) {
  await action.then(() => void 0, () => void 0);
}
async function installGatewayAutostart(options = {}) {
  const { cliPath, nodePath, home } = paths(options);
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const path = join8(home, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
    await mkdir6(dirname2(path), { recursive: true, mode: 448 });
    await writeFile3(path, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${SERVICE_NAME}</string><key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(cliPath)}</string><string>gateway</string><string>run</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string></dict></plist>
`, { mode: 384 });
    await ignoreMissingService(command(options, "launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, path], "GATEWAY_SERVICE_UNAVAILABLE"));
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
    const path = join8(home, ".config", "systemd", "user", "agcomm-runtime-gateway.service");
    await mkdir6(dirname2(path), { recursive: true, mode: 448 });
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
  throw new AiRuntimeError16("GATEWAY_SERVICE_UNAVAILABLE", `Runtime Gateway login service is not supported on ${platform}`);
}
async function uninstallGatewayAutostart(options = {}) {
  const { home } = paths(options);
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const path = join8(home, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
    await ignoreMissingService(command(options, "launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, path], "GATEWAY_SERVICE_UNAVAILABLE"));
    await rm7(path, { force: true });
    return;
  }
  if (platform === "win32") {
    await ignoreMissingService(command(options, "schtasks.exe", ["/Delete", "/F", "/TN", "AgComm Runtime Gateway"], "GATEWAY_SERVICE_UNAVAILABLE"));
    return;
  }
  if (platform === "linux") {
    await ignoreMissingService(command(options, "systemctl", ["--user", "disable", "--now", "agcomm-runtime-gateway.service"], "GATEWAY_SERVICE_UNAVAILABLE"));
    await rm7(join8(home, ".config", "systemd", "user", "agcomm-runtime-gateway.service"), { force: true });
    await command(options, "systemctl", ["--user", "daemon-reload"], "GATEWAY_SERVICE_UNAVAILABLE");
    return;
  }
  throw new AiRuntimeError16("GATEWAY_SERVICE_UNAVAILABLE", `Runtime Gateway login service is not supported on ${platform}`);
}
export {
  RuntimeGateway,
  connectRuntimeGateway,
  createGatewayCredentialStore,
  createRuntimeGateway,
  installGatewayAutostart,
  uninstallGatewayAutostart
};
