# `@agcomm/ai-runtime` Usage Guide

AgComm Runtime is the canonical local executor for AgComm Beta 1 `.ai` packages. It provides a Node.js library, the `agcomm` CLI, a full-screen TUI, portable bundle security, persistent sessions, local knowledge, streaming, and integration with the independent `@agcomm/gateway` control plane.

This guide covers installation, CLI modes, providers, Gateway operation, flow behavior, portable bundles, library embedding, permissions, and security boundaries.

## 1. Scope

Runtime supports:

- Parsing and validating AgComm `.ai` ZIP packages.
- Flow compilation and DAG execution.
- INPUT checkpoints and resume.
- Skill and Workspace model calls.
- HTTP, CONDITION, CODE, CONTACT, and OUTPUT nodes.
- Workspace Hooks and application-level Flow Hooks.
- Portable plugins in restricted Worker sandboxes.
- Multi-turn sessions and package-hash-isolated history.
- Application- and session-scoped local knowledge.
- Text and full event streams.
- TUI provider, trust, permission, session, knowledge, Gateway, and Inbox management.

Runtime does not edit `.ai` packages or provide a graphical desktop application. Gateway control-plane APIs are exported from `@agcomm/gateway`, not from the Runtime root entry.

## 2. Requirements and Installation

- Node.js `>=22.13.0`.
- A terminal for interactive TUI use.
- A model provider when a reachable Skill or Workspace needs one.
- An embedding provider when knowledge indexing or retrieval is enabled.

```bash
npm install @agcomm/ai-runtime
```

This installs `@agcomm/gateway` automatically and exposes the `agcomm` binary.

## 3. CLI Quick Start

Run an application with OpenAI-compatible defaults:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-4.1-mini"

agcomm workflow.ai --input "Summarize this"
```

Common modes:

```bash
agcomm workflow.ai
agcomm workflow.ai --headless
agcomm workflow.ai --batch --input "hello"
agcomm workflow.ai --stream --input "hello"
agcomm workflow.ai --allow-unsigned-plugins --input "trusted local package"
agcomm open
```

`agcomm open` requires a full TTY. When no path is provided in a non-interactive environment, Runtime returns an argument error rather than opening a file picker.

## 4. CLI Options

```text
agcomm [open | <file.ai>] [options]

--input <text>                 Set the primary user input
--vars <json>                  Merge a JSON object into flow variables
--headless                     Use sequential terminal forms instead of the full-screen TUI
--batch                        Run without waiting for user input
--json                         Emit machine-readable JSON output
--stream                       Write only final-output text chunks to stdout
--allow-unsigned-plugins       Allow trusted local unsigned portable bundles
--version                      Print the Runtime version
--help                         Print command help
```

`--stream` is incompatible with `--json` and `agcomm open`. `--batch` and `--headless` are mutually exclusive. Runtime returns `INVALID_ARGUMENTS` for invalid combinations.

## 5. Run Modes

### Full-Screen TUI

The default mode in a complete TTY. It provides:

- `.ai` file browsing and package summaries.
- Provider profile create, select, edit, and delete operations.
- Trusted publisher keys and package-bound unsigned-bundle approvals.
- INPUT forms, message history, streaming output, cancellation, and activity traces.
- Node state, tool calls, Hook activity, plugin logs, and errors.
- Session create, select, rename, and delete operations.
- Knowledge import, scope selection, reindex, and removal.
- Gateway app state, schedules, live runs, history, Inbox, and delivery retry.

Runtime restores terminal state on success, error, or cancellation. Terminal output is sanitized to remove unsafe ANSI and OSC control sequences.

### Headless Mode

```bash
agcomm workflow.ai --headless
```

In a TTY, headless mode asks for INPUT values sequentially. Existing defaults are shown and Enter accepts the current value. Invalid values retain prior answers and repeat only the current INPUT request.

In a non-TTY environment, headless mode never waits for stdin. All required INPUT values must be provided through package defaults, `--vars`, or `--input`; otherwise Runtime returns `INPUT_VALUES_REQUIRED`.

### Batch Mode

```bash
agcomm workflow.ai --batch \
  --vars '{"language":"en"}' \
  --input "Generate the report"
```

Batch mode never opens the TUI or prompts for INPUT. It is suitable for CI, server jobs, pipelines, and other automation where stdin cannot be used.

### Stream Mode

```bash
agcomm workflow.ai --stream --input "Generate the report"
```

Stream mode writes only final-output text chunks to stdout and appends one newline on success. It does not emit the final JSON document. Errors go to stderr and retain the standard exit code.

## 6. Non-TTY Behavior

When stdin, stdout, or stderr is not an interactive terminal, Runtime remains script-friendly:

- No full-screen TUI.
- No file, trust, permission, or Gateway approval dialogs.
- No automatic background app installation, update, or enablement.
- Default and batch runs emit one JSON document.
- Explicit headless mode validates pre-supplied INPUT values without reading stdin.
- Unsigned bundles require `--allow-unsigned-plugins` and explicit grants.

Empty strings, `false`, and `0` count as supplied INPUT values. Button groups require a value matching one configured `buttonValue`.

## 7. JSON Results and Exit Codes

Successful non-stream output:

```json
{
  "ok": true,
  "status": "completed",
  "output": "Final output",
  "variables": {
    "user_input": "User request"
  },
  "records": [],
  "toolCalls": [],
  "logs": [],
  "model": "gpt-4.1-mini",
  "elapsedMs": 1250
}
```

Failure output:

```json
{
  "ok": false,
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "The .ai file was not found"
  }
}
```

Failures return a nonzero exit code. `SIGINT` returns `130`. Runtime redacts configured provider secrets and values that resemble API keys from errors and logs. Request bodies, response bodies, and authentication headers are not copied into error JSON.

## 8. OpenAI-Compatible Provider

Default environment variables:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4.1-mini"
export OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
```

`OPENAI_API_KEY` is required only if a reachable Skill or Workspace needs a model. `OPENAI_EMBEDDING_MODEL` is required only for knowledge operations when no custom embedding provider is injected.

The endpoint must be public HTTPS. Redirects, private addresses, loopback addresses, oversized responses, and invalid protocol responses are rejected.

Provider selection priority is:

1. An explicit `RuntimeOptions.provider` supplied by the library caller.
2. A selected generic HTTP connection.
3. `OPENAI_*` environment overrides.
4. The locally selected provider profile.
5. Runtime model defaults.

Provider profile metadata is stored atomically in `~/.agcomm/runtime/config.json`. API keys are stored only in the operating-system credential store.

## 9. Generic HTTP Model Provider

Use a generic HTTP provider when a model service does not implement the OpenAI-compatible protocol.

Select a connection:

```bash
export AI_MODEL_CONNECTION="vendor"
```

Configure connections as a JSON object:

```bash
export AI_HTTP_CONNECTIONS='{
  "vendor": {
    "url": "https://models.example.com/generate",
    "method": "POST",
    "model": "vendor-model",
    "timeoutMs": 60000,
    "auth": { "type": "bearer", "tokenEnv": "VENDOR_TOKEN" },
    "requestTransformer": "({ messages, tools, model }) => ({ body: { messages, tools, model } })",
    "response": { "mode": "json", "contentPointer": "/result/text" }
  }
}'
```

Supported methods are `POST`, `PUT`, and `PATCH`. Static headers cannot override protected headers such as `Authorization`, `Host`, `Content-Length`, or `Cookie`.

Authentication modes:

```json
{ "type": "none" }
{ "type": "bearer", "tokenEnv": "VENDOR_TOKEN" }
{ "type": "api-key", "header": "x-api-key", "valueEnv": "VENDOR_KEY" }
{ "type": "basic", "usernameEnv": "VENDOR_USER", "passwordEnv": "VENDOR_PASSWORD" }
```

Secrets must be referenced through separate environment variables and must not appear directly in `AI_HTTP_CONNECTIONS`.

### Request Transformer

The transformer receives normalized model context:

```ts
({ messages, tools, toolChoice, model, temperature, maxTokens, forceFinal, signal }) => ({
  headers: { "x-client": "agcomm" },
  body: { messages, tools, model },
});
```

The transformer may be synchronous or asynchronous and must return a JSON-compatible body within the configured size limit. It runs in the host Node.js process and therefore must come only from trusted operations configuration. It cannot replace the URL, HTTP method, authentication, or protected headers.

### JSON Response Mapping

JSON mode uses RFC 6901 JSON Pointers:

```json
{
  "mode": "json",
  "contentPointer": "/result/text",
  "toolCallsPointer": "/result/tool_calls",
  "usageInputPointer": "/usage/input_tokens",
  "usageOutputPointer": "/usage/output_tokens"
}
```

### SSE Response Mapping

SSE mode maps incremental text and tool-call fields:

```json
{
  "mode": "sse",
  "contentPointer": "/delta/content",
  "toolCallIndexPointer": "/delta/tool/index",
  "toolCallIdPointer": "/delta/tool/id",
  "toolCallNamePointer": "/delta/tool/name",
  "toolCallArgumentsPointer": "/delta/tool/arguments",
  "donePointer": "/done"
}
```

Runtime parses standard SSE event boundaries, merges multiple `data:` lines, and accumulates tool arguments in order. A Workspace or plugin-enabled Skill fails with `PROVIDER_TOOLS_UNSUPPORTED` before execution if the selected provider lacks tool-call mapping.

## 10. Gateway Background Service

Gateway is a separate package installed with Runtime. The daemon entry remains:

```bash
agcomm gateway run
```

The daemon uses authenticated current-user local IPC only. It does not open a TCP control port.

On every full-TTY open of a background-enabled app, Runtime displays:

- Application ID, version, and package hash.
- Heartbeat and Cron triggers.
- Bundle signatures and permissions.
- Webhook data scope and destination.

Approval preflights provider availability, bundle trust, and permissions before installing or enabling the app. Rejection disables the installed app without deleting Inbox, run history, sessions, or knowledge.

Current-user service integration:

- macOS: LaunchAgent `io.agcomm.runtime.gateway`.
- Windows: Task Scheduler task `AgComm Runtime Gateway`.
- Linux: systemd user service `agcomm-runtime-gateway.service`.

The stable Gateway data directory is `~/.agcomm/runtime/gateway`. App packages, registry data, Inbox, run records, delivery queues, authentication tokens, and stream logs retain their existing formats across package updates.

Use Gateway APIs directly from the control-plane package:

```ts
import { connectRuntimeGateway, createRuntimeGateway } from "@agcomm/gateway";

const client = await connectRuntimeGateway();
console.log(await client.listApps());

const gateway = createRuntimeGateway({ runtime: { provider } });
await gateway.start();
```

## 11. Background Scheduling and CONTACT

Gateway supports one Heartbeat and up to 64 Cron triggers per application. It permits one active background flow per app and coalesces overlapping instances of the same trigger.

- Heartbeat does not backfill missed intervals after sleep or downtime.
- Cron may backfill once within its configured misfire grace period.
- Package updates stop old schedules, cancel old runs, and atomically replace the installed package.
- Each trigger uses a hidden persistent session but receives only the previous summary after a package update.
- Failed scheduled runs are recorded and wait for the next scheduled occurrence.

CONTACT is valid only in a Gateway background execution. It writes Inbox atomically before Webhook delivery. A foreground run that reaches CONTACT fails with `CONTACT_REQUIRES_GATEWAY`.

Webhook requirements:

- Public HTTPS URL without embedded credentials.
- HMAC-SHA256 signature using a secret stored only in the OS credential store.
- Event ID used as the idempotency key.
- Retry delays of 1 minute, 5 minutes, 30 minutes, and 2 hours.
- Response and log size limits with secret redaction.

## 12. Flow Execution

Runtime validates and executes:

- The package manifest, ZIP structure, schemas, and references.
- Variables, defaults, type conversion, and templates.
- DAG dependencies, conditions, bounded loops in supported packages, concurrency, timeout, retry, and cancellation.
- INPUT checkpoints without repeating completed nodes.
- Public HTTPS flow HTTP requests.
- Skill model calls and Workspace tool delegation.
- CODE functions without requiring a model provider.
- OUTPUT rendering and visualization metadata.

Standalone flow HTTP nodes and generic HTTP model providers are separate features. Configuring a model connection does not change flow HTTP behavior or `.ai` schemas.

## 13. Workspace and Flow Hooks

A Workspace can bind ordered Hook bundles for start, finish, before and after model calls, before and after tool calls, and error observation.

- Before stages run in declaration order.
- After, finish, and error stages run in reverse order.
- Hook state is JSON, limited to 256 KiB, and exists for one Workspace execution.
- Variable patches are local to that Workspace.
- `beforeTool.skipWith` may supply a replacement tool result.
- `onError` observes failures and cannot convert them to success.

Application-level Flow Hooks intercept standalone DAG nodes:

- `beforeNode` runs before every node attempt.
- `afterNode` runs after final success, skip, or recovery.
- `onNodeError` runs only after node retries are exhausted.
- `recoverWith` turns a node failure into a successful output.
- Flow Hook failures terminate with `FLOW_HOOK_FAILED` and are not recursively recovered.
- Modified HTTP configuration is always revalidated against public HTTPS, DNS, redirect, and response-size policy.

## 14. Portable Bundles

Runtime executes portable Plugin, CODE, Workspace Hook, and Flow Hook bundles only after validating:

- Runtime target and bundle kind.
- Bundle integrity.
- Manifest and input/output schemas.
- Signature and trusted publisher, when signed.
- Package-bound unsigned authorization, when unsigned.
- Declared permissions and host grants.
- Timeout, concurrency, cancellation, and output-size limits.

Unsigned bundles are rejected by default. For trusted local packages in non-interactive use:

```bash
agcomm workflow.ai --allow-unsigned-plugins
```

```ts
const runtime = createRuntime({
  allowUnsignedPlugins: true,
  grants: {
    text_tools: [],
  },
});
```

This option does not allow invalid signatures, unknown signed publishers, integrity mismatches, undeclared permissions, or sandbox escape.

Bundles execute in a restricted Worker VM without Node `process`, filesystem, network, child processes, dynamic import, or string code generation. Host capabilities are available only through declared and granted permission adapters.

## 15. JavaScript API

### Create and Dispose Runtime

```js
import {
  createRuntime,
  createHttpModelProvider,
  createTerminalRenderer,
} from "@agcomm/ai-runtime";

const runtime = createRuntime({
  provider: createHttpModelProvider({
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  }),
  trustedKeys: {},
  grants: {},
  permissions: {},
});

try {
  const result = await runtime.runAiFile("workflow.ai", {
    input: "Review this release",
    variables: { language: "en" },
    renderer: createTerminalRenderer(),
  });
  console.log(result.output);
} finally {
  await runtime.dispose();
}
```

`runAiFile()` is a one-shot compatibility API. It parses, executes, and releases package resources without creating persistent history.

### Application Handle

```js
const app = await runtime.openAiApp("workflow.ai");
try {
  console.log(app.info);
  const result = await app.run({ input: "One-shot app run" });
  console.log(result.output);
} finally {
  await app.dispose();
}
```

An application handle parses the package once and exposes package information, run APIs, sessions, and knowledge operations.

### Sessions

```js
const app = await runtime.openAiApp("assistant.ai");
const session = await app.createSession({ title: "Release review" });

try {
  await session.runTurn("Review the release plan");
  await session.runTurn("Focus on migration risk");
  console.log(await session.history());
  await session.rename("Migration review");
} finally {
  await session.dispose();
  await app.dispose();
}
```

Only successful turns save a final assistant response. Failed turns retain user input, time, failed status, and a summary, but not internal model messages or intermediate tool prompts.

### Streaming

```js
const stream = await runtime.streamAiFile("workflow.ai", {
  mode: "text",
  input: "Generate the report",
});

for await (const chunk of stream) process.stdout.write(chunk);
const result = await stream.result;
```

Event mode:

```js
const stream = app.stream({ mode: "events", input: "Inspect this flow" });
for await (const event of stream) {
  console.log(event.sequence, event.type);
}
await stream.result;
```

Text mode emits only content consistent with final OUTPUT. Direct unchanged Skill or Workspace text may stream incrementally; templates, joins, structured values, CODE output, or output-modifying Hooks are emitted as one final block. Event mode includes run, model, node, tool, Hook, plugin log, output delta, and final result or error events.

Each `AiRunStream` allows one consumer. `cancel()`, an external aborted signal, or early iteration exit cancels execution. A buffer over 1 MiB fails with `STREAM_BACKPRESSURE_EXCEEDED`. Callback failures use `STREAM_CALLBACK_FAILED`.

### Knowledge

```js
const app = await runtime.openAiApp("assistant.ai");

await app.importKnowledge(["./handbook.md"], {
  scope: { type: "app" },
});

const session = await app.createSession();
await app.importKnowledge(["./customer.csv"], {
  scope: { type: "session", sessionId: session.id },
});

console.log(await app.listKnowledge({ type: "app" }));
```

Built-in parsers support UTF-8 TXT, Markdown, JSON, and CSV. Custom parsers can be registered in `RuntimeOptions.knowledgeParsers` and are never serialized into `.ai`.

Import limits:

- 20 MiB per file.
- 200 source files per scope.
- 20,000 chunks per scope.
- No symlink, traversal, or out-of-bound paths.

Embeddings are required. Runtime stores Float32 vectors and atomic metadata and performs local cosine-similarity scanning. It does not fall back to full-text search.

## 16. Custom Renderer

A host can implement its own interface:

```ts
const renderer = {
  async requestInput(request, signal) {
    signal.throwIfAborted();
    return { user_input: "Host-provided value" };
  },
  onFlowEvent(event) {
    console.log(event.type, event.nodeId);
  },
  onToolCall(event) {
    console.log(event.toolId, event.status);
  },
  onPluginLog(event) {
    console.error(event.level, event.message);
  },
};
```

`requestInput` returns a map from variable names to submitted values. Runtime still performs type conversion and schema validation using package variable definitions.

## 17. Permission Adapters

Library callers can inject host capabilities:

```ts
const runtime = createRuntime({
  permissions: {
    "filesystem:read": async (request, context) => readSelectedFile(request, context),
    "filesystem:write": async (request, context) => writeSelectedFile(request, context),
    "document:read": async (request, context) => readDocument(request, context),
    "document:write": async (request, context) => writeDocument(request, context),
    "clipboard:read": async () => readClipboard(),
    "clipboard:write": async (request) => writeClipboard(request),
    "screen:read": async () => captureScreen(),
  },
});
```

Runtime checks every layer: the bundle must declare the permission, the host must grant it, the invocation must request it, and an adapter must implement it. TUI file and document selection uses opaque process-local handles, canonical paths, symlink checks, and an 8 MiB operation limit. Batch mode cannot open a selector; callers must inject an adapter.

Native credential store, clipboard, and screenshot operations fail explicitly when unavailable. Runtime never falls back to plaintext credential files or shell commands.

## 18. Network and Data Security

Network boundaries:

- Model endpoints and flow HTTP destinations must use public HTTPS.
- Private, loopback, link-local, credential-bearing, and unsafe redirect targets are rejected.
- DNS results are checked before requests and redirects.
- Request timeout, response size, and cancellation are enforced.
- Webhook destinations use the same public-HTTPS and redirect policy.

Data boundaries:

- Without declared history, CLI runs do not persist input, model output, or plugin logs.
- Persistent data is isolated by SHA-256 of complete package bytes.
- Human-readable renderer output goes to stderr; machine output goes to stdout.
- API keys remain in the OS credential store.
- Trust records bind package hash, bundle ID, integrity, and permissions.
- Any package or permission change requires a new trust decision.

## 19. Common Errors

| Code | Meaning |
| --- | --- |
| `FILE_NOT_FOUND` | The requested `.ai` path does not exist. |
| `INVALID_ARGUMENTS` | CLI options conflict or required arguments are missing. |
| `INPUT_VALUES_REQUIRED` | A non-interactive run lacks required INPUT values. |
| `PROVIDER_REQUIRED` | A reachable model node has no configured provider. |
| `HTTP_CONNECTION_NOT_FOUND` | `AI_MODEL_CONNECTION` names an unknown connection. |
| `HTTP_CONNECTION_INVALID` | Generic HTTP provider configuration is invalid. |
| `HTTP_AUTH_MISSING` | A referenced authentication environment variable is absent. |
| `HTTP_TRANSFORM_FAILED` | The request transformer failed or returned invalid data. |
| `PROVIDER_TOOLS_UNSUPPORTED` | The selected provider cannot map required tool calls. |
| `EMBEDDING_PROVIDER_REQUIRED` | Knowledge needs embeddings but none are configured. |
| `KNOWLEDGE_INDEX_FAILED` | A source could not be parsed or indexed. |
| `CONTACT_REQUIRES_GATEWAY` | CONTACT was reached outside a Gateway background run. |
| `PLUGIN_SIGNATURE_INVALID` | A portable bundle signature is invalid. |
| `PLUGIN_PUBLISHER_UNKNOWN` | A signed bundle uses an untrusted publisher key. |
| `PLUGIN_INTEGRITY_INVALID` | Bundle bytes do not match declared integrity. |
| `STREAM_CALLBACK_FAILED` | A stream callback threw an error. |
| `STREAM_BACKPRESSURE_EXCEEDED` | Buffered stream data exceeded 1 MiB. |
| `CANCELLED` | The caller or user cancelled execution. |

Treat error codes as the stable API. Error messages are descriptive text and may evolve.

## 20. Recommended Practices

- Use `--batch` for CI and unattended automation.
- Use `--headless` when a person fills forms but another process reads the final JSON.
- Use the full-screen TUI for local interactive work.
- Parse stdout only; treat stderr as human-readable diagnostics.
- Never place secrets in `.ai`, `AI_HTTP_CONNECTIONS`, logs, or Hook state.
- Load `requestTransformer` only from trusted operations configuration.
- Trust only explicit publisher keys and grant the minimum permissions.
- Use temporary `dataDir` paths in persistence tests.
- Dispose streams, sessions, app handles, Runtime instances, and Gateway instances.
- Inject providers, renderers, permissions, native adapters, and logging policy from production host applications.

## 21. Current Boundaries

Runtime is intended for local terminal and embedded Node.js execution. It does not:

- Edit or design `.ai` flows.
- Start a graphical desktop application.
- Open a network Gateway control port.
- Execute server plugins.
- Execute unauthorized unsigned bundles or unknown signed publishers.
- Downgrade missing embeddings to keyword search.
- Store credentials in plaintext when native credential storage is unavailable.
- Permit untrusted Node.js execution inside portable bundles.
