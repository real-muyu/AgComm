# `@agcomm/ai-sdk` Developer Guide

This guide is for engineers building AgComm `.ai` applications with Node.js 22+ and TypeScript. The SDK uses a typed builder to generate AgComm Beta 1 DAG packages that run with `@agcomm/ai-runtime`, the `agcomm` CLI, or the SDK Runner.

`@agcomm/ai-runtime` installs the independent `@agcomm/gateway` control plane automatically. Gateway client, scheduling, and service-management APIs are exported only from `@agcomm/gateway`; `installBackgroundApp()` wraps the common installation workflow for SDK applications.

The SDK creates applications from code. It does not read, edit, or merge existing `.ai` files. Ordinary TypeScript `if` and `for` statements determine the generated graph at build time. Use `flow.condition()` when a branch must be selected at runtime.

## 1. Installation and Project Setup

Requirements:

- Node.js `>=22.13.0`.
- An ESM TypeScript project.
- `@agcomm/ai-runtime` as a required peer dependency.

```bash
npm install @agcomm/ai-sdk @agcomm/ai-runtime
npm install --save-dev typescript tsx
```

Recommended `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true
  }
}
```

## 2. Minimal Application

```ts
import {
  defineApp,
  defineSkill,
  template,
  variable,
  writeAi,
} from "@agcomm/ai-sdk";

const question = variable.string("user_input");

const assistant = defineSkill({
  id: "assistant",
  name: "Assistant",
  description: "Answer the user's question",
  category: "General",
  prompt: "Answer clearly and concisely: {{skill_input}}",
});

const app = defineApp({
  name: "Question Answering",
  variables: [question],
  skills: [assistant],
}, ({ flow }) => {
  const form = flow.input({
    id: "question_form",
    fields: [{ variable: question, label: "Question", component: "input", size: "large" }],
  });

  const answer = flow.skill({
    id: "answer",
    skill: assistant,
    input: question,
    output: "answer_text",
    after: form,
  });

  flow.output({ id: "result", value: template`${answer}` });
});

await writeAi(app, new URL("../dist/app.ai", import.meta.url));
```

```bash
npx tsx src/app.ts
```

Every node and Skill requires a stable ID. IDs may contain letters, digits, underscores, and hyphens, must begin with a letter or digit, and may not exceed 64 characters.

## 3. Core Concepts

### 3.1 Variables

```ts
const title = variable.string("title", "Untitled");
const content = variable.markdown("content");
const score = variable.number("score", 0);
const approved = variable.boolean("approved", false);
const tags = variable.array<string[]>("tags", []);
const metadata = variable.object<{ owner: string }>("metadata", { owner: "" });
```

Variable names must match `[A-Za-z_][A-Za-z0-9_]{0,63}`. A node output may name a new variable or reuse an existing `VariableRef<T>`:

```ts
const response = variable.string("response");

flow.skill({
  id: "writer",
  skill: writer,
  input: title,
  output: response,
});
```

The SDK exposes these read-only runtime variables when the corresponding interaction or background capability is enabled:

- `session_id`
- `conversation_history`
- `knowledge_context`
- `background_trigger`
- `gateway_run_id`

Applications cannot declare or overwrite reserved variables.

### 3.2 Templates and References

`template` preserves variable and node references so the builder can infer producer dependencies:

```ts
const prompt = template`Title: ${title}\nDraft: ${draft}`;
```

Do not convert references to plain strings before passing them to the builder. A `NodeRef<T>` carries its TypeScript type, output variable name, and producing node ID.

### 3.3 Skills

```ts
const reviewer = defineSkill({
  id: "reviewer",
  name: "Reviewer",
  description: "Review a draft",
  category: "Quality",
  prompt: "Review {{skill_input}} and return actionable feedback.",
});
```

`prompt` accepts a string or `Template`. For `flow.workspace()`, the manager Skill and every allowlisted child Skill must be included in `defineApp({ skills })`.

## 4. Flow Builder

All nodes support these common options:

```ts
{
  id: string;
  title?: string;
  output?: string | VariableRef<T>;
  after?: NodeRef<unknown> | ConditionBranchRef |
    readonly (NodeRef<unknown> | ConditionBranchRef)[];
  position?: { x: number; y: number };
}
```

Dependency rules:

1. References in input values and templates infer producer dependencies.
2. Explicit `after` dependencies are merged with inferred dependencies.
3. Without `after` or references, a node follows the previous node.
4. `after: []` connects directly to the single START node.
5. Missing coordinates use stable automatic DAG layout; explicit coordinates are preserved.

### 4.1 INPUT

```ts
const form = flow.input({
  id: "collect",
  title: "Request",
  layout: "two-column",
  fields: [
    { variable: title, label: "Title", component: "input", size: "large" },
    { variable: approved, label: "Approved", component: "checkbox", size: "small" },
  ],
});
```

Runtime TUI or a host renderer displays INPUT forms. Field controls must be compatible with their variable types.

### 4.2 Skill

```ts
const draft = flow.skill({
  id: "draft",
  skill: writer,
  input: template`Write about ${title}`,
  output: "draft_text",
  after: form,
});
```

### 4.3 Workspace

A Workspace lets a manager Skill call allowlisted Skills during execution:

```ts
const finalReport = flow.workspace({
  id: "coordinate",
  agent: manager,
  skills: [writer, reviewer],
  input: draft,
  maxIterations: 3,
  timeoutMs: 150_000,
  output: "final_report",
});
```

Heavy applications can set both application and node timeouts. The application range is 1 to 600,000 ms and defaults to 60,000 ms. Nodes default to 30,000 ms.

```ts
defineApp({
  name: "Long Report",
  timeoutMs: 180_000,
  maxConcurrency: 3,
  skills: [manager, writer],
}, ({ flow }) => {
  const result = flow.workspace({
    id: "coordinate",
    agent: manager,
    skills: [writer],
    maxIterations: 3,
    timeoutMs: 150_000,
  });
  flow.output({ id: "result", value: result });
});
```

Conversation history and knowledge context are injected only into top-level SKILL and WORKSPACE nodes. A delegated child Skill receives only the current delegation input.

### 4.4 Workspace Hooks

Define a Workspace Hook in an independent TypeScript entry file:

```ts
// policy.hook.ts
import { defineWorkspaceHook } from "@agcomm/ai-sdk/hook";

export default defineWorkspaceHook<{ calls: number }>({
  entry: import.meta.url,
  id: "workspace_policy",
  name: "Workspace Policy",
  description: "Workspace lifecycle policy",
  version: "1.0.0",
  handlers: {
    onStart(event) {
      return { input: event.input.trim(), variables: { normalized: true }, state: { calls: 0 } };
    },
    beforeModel(event) {
      return { systemInstruction: "Do not expose internal identifiers.", state: event.state };
    },
    beforeTool(event) {
      if (event.tool.id === "cached_lookup") return { skipWith: "cached result", state: event.state };
      return { input: event.input, state: event.state };
    },
    onError(event, context) {
      context.log("error", event.error.message);
    },
  },
});
```

Bind the definition to a Workspace:

```ts
const result = flow.workspace({
  id: "coordinate",
  agent: manager,
  skills: [writer, reviewer],
  hooks: [workspacePolicy],
  input: draft,
});
```

Before stages run in declaration order; after, finish, and error stages run in reverse order. Each Hook has at most 256 KiB of JSON state that exists only for one Workspace execution. Variable patches affect only later model calls, child Skills, and Hooks in that Workspace. `afterModel` may rewrite text but not tool selections. `onError` observes errors and cannot recover them. Hooks share plugin integrity, signature, permission, timeout, output, and Worker sandbox enforcement.

### 4.5 Flow Hooks

Workspace Hooks cover only model and tool activity inside a Workspace. Use application-level Flow Hooks for standalone HTTP, CODE, Skill, and other DAG nodes:

```ts
// http-policy.flow-hook.ts
import { defineFlowHook } from "@agcomm/ai-sdk/flow-hook";

export default defineFlowHook<{ rewrites: number }>({
  entry: import.meta.url,
  id: "http_policy",
  name: "HTTP Policy",
  description: "Normalize region and recover optional HTTP failures",
  version: "1.0.0",
  handlers: {
    beforeNode(event) {
      if (event.node.type !== "HTTP") return;
      return {
        config: { ...event.node.config, url: String(event.node.config.url).replace("region=APAC", "region=global") },
        state: { rewrites: (event.state?.rewrites ?? 0) + 1 },
      };
    },
    onNodeError(event) {
      if (event.node.id !== "market_request") return;
      return { recoverWith: { status: 200, headers: {}, body: { items: [], recovered: true } }, state: event.state };
    },
  },
});
```

Attach Flow Hooks with `defineApp({ hooks: [httpPolicy] })`. `beforeNode` runs before each attempt and may replace `config` or return `skipWith`. `afterNode` runs in reverse order after success, skip, or recovery and may rewrite output. `onNodeError` runs only after node retries are exhausted. Returning `recoverWith` converts the failure to a successful output; otherwise the original error terminates the DAG. Hook-modified HTTP requests still pass all Runtime network checks.

### 4.6 HTTP

```ts
const check = flow.http<{ accepted: boolean }>({
  id: "publication_check",
  method: "POST",
  url: "https://api.example.com/check",
  headers: { "content-type": "application/json" },
  body: { draft },
  output: "publication_response",
});
```

`check` is a `NodeRef<{ status: number; headers: Record<string, string>; body: { accepted: boolean } }>`. Runtime permits only public HTTPS destinations and rejects credential-bearing URLs, loopback or private addresses, and unsafe redirects.

### 4.7 Conditions

```ts
const decision = flow.condition({
  id: "approval_decision",
  expression: template`${approved} == true && ${score} >= 0.7`,
  after: form,
});

flow.skill({ id: "accepted", skill: publisher, after: decision.whenTrue() });
flow.skill({ id: "rejected", skill: reviewer, after: decision.whenFalse() });
```

The restricted expression grammar is validated at build time. Each branch allows one direct consumer. For fan-out, create one first branch node and fan out from that node. Never pass a condition node directly to `after`; use `whenTrue()` or `whenFalse()`.

### 4.8 TypeScript CODE

Deterministic operations that do not need a model belong in an independent CODE entry:

```ts
// regex.code.ts
import { defineCode } from "@agcomm/ai-sdk/code";

export default defineCode<{ text: string; pattern: string }, { matches: string[] }>({
  entry: import.meta.url,
  id: "regex_extract",
  name: "Regex Extract",
  description: "Extract regular expression matches",
  version: "1.0.0",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" }, pattern: { type: "string" } },
    required: ["text", "pattern"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { matches: { type: "array", items: { type: "string" } } },
    required: ["matches"],
    additionalProperties: false,
  },
  run(input, context) {
    context.checkAborted();
    return { matches: [...input.text.matchAll(new RegExp(input.pattern, "g"))].map(match => match[0]) };
  },
});
```

```ts
const matches = flow.code({
  id: "extract",
  code: regexExtract,
  input: { text: userInput, pattern: "[A-Z]+" },
  output: "matches",
});
```

A definition may be reused by multiple nodes and is bundled once. Generics validate inputs at compile time and required JSON schemas validate every execution. CODE shares integrity, signature, permissions, timeout, concurrency, output limits, and the Worker sandbox with portable plugins.

### 4.9 OUTPUT and Visualizations

Every application requires at least one reachable OUTPUT:

```ts
flow.output({
  id: "result",
  value: template`${finalReport}`,
  output: "final_output",
});
```

Supported visualization kinds are `bar | line | pie | area | scatter | radar` and are declared in `defineApp({ visualizations })`.

## 5. TypeScript Build-Time Control Flow

Ordinary TypeScript control flow changes only the generated static DAG:

```ts
const enabledReviewers = [legalReviewer, securityReviewer];
const reviews = [];

for (const skill of enabledReviewers) {
  reviews.push(flow.skill({
    id: `review_${skill.id}`,
    skill,
    input: draft,
    after: draft,
  }));
}

if (process.env.ENABLE_PUBLICATION === "1") {
  flow.skill({ id: "publish", skill: publisher, after: reviews });
}
```

These statements do not create loop or CONDITION nodes. Use `flow.condition()` to select a path from runtime variables.

## 6. Conversations, History, and Knowledge

```ts
const app = defineApp({
  name: "Knowledge Assistant",
  interaction: {
    conversation: { history: true, historyWindow: 20 },
    knowledge: {
      enabled: true,
      scopes: ["app", "session"],
      topK: 6,
      chunkSize: 1200,
      chunkOverlap: 200,
    },
    streaming: { defaultMode: "text" },
  },
  variables: [question],
  skills: [assistant],
}, ({ flow }) => {
  // Build the DAG here.
});
```

Configuration semantics:

- `multiTurn: true` retains context only in the current process.
- `history: true` enables multi-turn context and local persistence.
- `historyWindow` defaults to `20`.
- Knowledge defaults to application scope.
- Session knowledge requires `history: true`.
- `topK` defaults to `6` after app and session results are merged and ranked.
- `chunkSize` defaults to 1,200 characters and `chunkOverlap` to 200.

Runtime isolates data by SHA-256 of the complete `.ai` bytes under `~/.agcomm/runtime/apps/<package-sha256>/`. Copying or moving identical bytes shares data; changing any byte creates a distinct application store. Data is protected by current-user filesystem permissions but is not encrypted.

## 7. Background Services

Declare background behavior through `defineApp({ background })`. A background app requires stable `id` and `version` values. Installing a new package with the same app ID atomically replaces the previous package.

```ts
const app = defineApp({
  id: "daily_assistant",
  version: "1.0.0",
  name: "Daily Assistant",
  background: {
    historyWindow: 20,
    heartbeat: {
      id: "monitor",
      everyMs: 15 * 60_000,
      input: "Check for items that require a reminder",
      variables: { source: "heartbeat" },
      runOnStart: false,
    },
    cron: [{
      id: "morning_report",
      expression: "0 9 * * 1-5",
      timezone: "Asia/Shanghai",
      input: "Generate today's work summary",
      variables: { reportType: "daily" },
      misfireGraceMs: 15 * 60_000,
    }],
  },
}, ({ flow }) => {
  const receipt = flow.contact({
    id: "notify_user",
    title: "Action required",
    body: "Review the Runtime Inbox",
    severity: "warning",
    webhook: true,
    dedupeKey: "daily-report",
  });
  flow.output({ id: "result", value: receipt });
});
```

Background constraints:

- One Heartbeat per app, with an interval from 60,000 to 86,400,000 ms.
- Up to 64 numeric five-field Cron triggers, each with a valid IANA timezone.
- `misfireGraceMs` defaults to 15 minutes and may not exceed 24 hours.
- Trigger input, trigger variables, or defaults must satisfy all INPUT fields.
- CONTACT always writes Inbox first; `webhook: true` adds asynchronous delivery.
- CONTACT outside Gateway execution fails with `CONTACT_REQUIRES_GATEWAY`.
- `background_trigger` and `gateway_run_id` are read-only runtime variables.

Install through an already running Gateway:

```ts
import { installBackgroundApp } from "@agcomm/ai-sdk";

await installBackgroundApp(app, {
  install: {
    enabled: true,
    webhook: {
      url: "https://hooks.example.com/agcomm",
      secret: process.env.WEBHOOK_SECRET,
    },
  },
});
```

For first use, run `agcomm app.ai` in a full TTY and complete provider, trust, permission, Webhook, and login-service approval. SDK APIs never open authorization dialogs.

## 8. Build APIs

### `compileApp(app)`

Compiles to `FlowProject` and validates nodes, edges, Skills, Workspaces, variables, hooks, and plugins:

```ts
const compiled = await compileApp(app);
console.log(compiled.project.nodes, compiled.project.edges);
```

### `buildAi(app)`

Returns complete `.ai` ZIP bytes after importer round-trip validation:

```ts
const bytes: Uint8Array = await buildAi(app);
```

### `writeAi(app, path)`

Creates parent directories and atomically replaces the target:

```ts
const result = await writeAi(app, "./dist/app.ai");
console.log(result.path, result.byteLength, result.compiled.project.name);
```

The path must end in `.ai`. URL arguments must use the `file:` protocol.

## 9. Development Run APIs

### One-Shot Runs

```ts
const result = await runApp(app, {
  runtime: { provider },
  run: { input: "Explain this application", variables: { approved: true } },
});
console.log(result.output);
```

`runApp()` builds, opens, runs, and disposes the package. It does not write persistent history.

### Reusable Runner

```ts
const runner = await createAppRunner(app, {
  provider,
  dataDir: "./.runtime-data",
});

try {
  const first = await runner.run({ input: "One-shot run" });
  const second = await runner.run({ input: "Another isolated run" });
  console.log(first.output, second.output);
} finally {
  await runner.dispose();
}
```

`runner.run()` reuses the built package but remains a non-persistent single-turn run. Always call `dispose()`.

### Persistent Sessions

```ts
const session = await runner.createSession({ title: "Architecture review" });
try {
  await session.runTurn("Review the data model");
  await session.runTurn("Now focus on migration risks");
  await session.rename("Migration review");
  console.log(await session.history());
} finally {
  await session.dispose();
}
```

Failed turns retain the user input and failed status, but never internal model messages, tool prompts, or hidden reasoning.

### Streaming

```ts
const text = await streamApp(app, {
  runtime: { provider },
  run: { mode: "text", input: "Write a report" },
});
for await (const chunk of text) process.stdout.write(chunk);
const result = await text.result;

const events = runner.stream({ mode: "events", input: "Inspect this flow" });
for await (const event of events) console.log(event.sequence, event.type);
await events.result;
```

Streaming entry points are `streamApp()`, `runner.stream()`, Runtime `appHandle.stream()`, `session.streamTurn()`, and `streamAiFile()`. One `for await` consumer is allowed. Calling `cancel()` or leaving iteration early cancels execution. Event-mode failures emit an `error` event and reject `result`; text-mode iteration throws directly. Ordinary run APIs may observe the same data through `onOutputDelta` and `onStreamEvent`.

## 10. Knowledge APIs

Knowledge requires `interaction.knowledge.enabled: true` and an embedding provider.

```ts
await runner.importKnowledge(["./docs/handbook.md"], {
  scope: { type: "app" },
  onProgress(progress) {
    console.error(progress.phase, progress.name, progress.completed, progress.total);
  },
});

const session = await runner.createSession();
await runner.importKnowledge(["./docs/customer.csv"], {
  scope: { type: "session", sessionId: session.id },
});

const documents = await runner.listKnowledge({ type: "app" });
await runner.reindexKnowledge(undefined, { scope: { type: "app" } });
await runner.removeKnowledge([documents[0].id], { type: "app" });
```

Built-in parsers support UTF-8 `.txt`, `.md`, `.json`, and `.csv`. Register host-only custom parsers through `RuntimeOptions.knowledgeParsers`:

```ts
const yamlParser = {
  id: "yaml-text",
  version: "1",
  extensions: [".yaml", ".yml"],
  async parse({ bytes, signal }) {
    signal.throwIfAborted();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  },
};
```

Limits are 20 MiB per file, 200 sources per scope, and 20,000 chunks per scope. Imports copy source files and deduplicate by content hash. Missing embeddings fail with `EMBEDDING_PROVIDER_REQUIRED`; indexing failures use `KNOWLEDGE_INDEX_FAILED`. There is no keyword-search fallback.

## 11. Portable Plugins

Place every plugin in an independent TypeScript entry and use `entry: import.meta.url`. The SDK bundles local and third-party dependencies into one browser-targeted ESM file without serializing closures.

```ts
import { definePlugin, defineTool } from "@agcomm/ai-sdk/plugin";

export default definePlugin({
  entry: import.meta.url,
  id: "text_tools",
  name: "Text Tools",
  version: "1.0.0",
  permissions: [],
  tools: {
    normalize: defineTool<{ text: string }, { text: string }>({
      description: "Normalize text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      async run(input, context) {
        context.checkAborted();
        return { text: input.text.trim() };
      },
    }),
  },
});
```

Add the plugin to `defineSkill({ plugins: [textTools] })`. Beta 1 creates only portable `runtime: "runtime"` bundles. Generated bundles are unsigned and require `allowUnsignedPlugins: true` or `--allow-unsigned-plugins` for trusted local use. Integrity, schema, permission, output, and sandbox validation always remain active; invalid signatures and unknown publishers are always rejected.

## 12. Error Handling

Build failures use `AiSdkError` with a stable `code` and structured `issues`:

```ts
try {
  await writeAi(app, "./dist/app.ai");
} catch (error) {
  if (error instanceof AiSdkError) {
    console.error(error.code, error.message);
    for (const issue of error.issues) {
      console.error(issue.code, issue.path, issue.nodeId, issue.message);
    }
  }
  throw error;
}
```

Pre-write validation covers invalid or duplicate IDs, duplicate variables, reserved-variable writes, invalid references, missing OUTPUT, unreachable nodes, invalid conditions, missing Skills or plugins, Workspace allowlists, INPUT forms, bundle metadata, and background requirements.

Runtime failures use `AiRuntimeError` with a stable `code`. Branch on the code rather than parsing message text.

## 13. CLI and TUI

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-4.1-mini"
export OPENAI_EMBEDDING_MODEL="text-embedding-3-small"

agcomm dist/app.ai
```

When an app declares conversations or knowledge and all standard streams are TTYs, Runtime opens the persistent session TUI. History mode supports creating, selecting, renaming, and deleting sessions. Knowledge mode supports scope selection, file browsing, multi-file import, removal, and reindexing. `agcomm open` also provides Gateway applications, schedules, live runs, history, enable/disable, uninstall, Inbox, read state, and failed delivery retry.

Automation remains single-run:

```bash
agcomm dist/app.ai --batch --input "Generate a report"
agcomm dist/app.ai --headless
agcomm dist/app.ai --batch --vars '{"approved":true}' --json
```

`--headless`, `--batch`, non-TTY, and JSON modes never open session or file-management interfaces.

## 14. Testing Guidance

Recommended coverage:

1. Assert nodes, edges, and interaction declarations with `compileApp()`.
2. Exercise complete packaging and importer round trips with `buildAi()`.
3. Use a mock `ModelProvider` for Skills, Workspaces, and conditions.
4. Use a mock `EmbeddingProvider` for knowledge tests.
5. Verify TypeScript `if` and `for` affect only the static graph.
6. Pass a temporary `dataDir` to persistence tests.
7. Dispose every Session, Runner, and Runtime handle.

The `examples/ai-sdk-report/` project covers forms, parallel Skills, conditions, HTTP, CODE, Workspaces, hooks, visualizations, plugins, history, knowledge, streaming, and background tasks.

## 15. Current Boundaries

- The SDK creates and exports applications; it does not modify existing `.ai` files.
- Beta 1 packages include extension entry source and bundled ESM, but not application builder source.
- There is no loop DSL. Use explicit bounded Flow definitions when iteration is required.
- Development runs execute the complete app, not an isolated node or Skill.
- Persistent sessions, knowledge, providers, trust, and Gateway interaction are managed by Runtime and its TUI.
- Custom knowledge parsers are host configuration and are never written into `.ai`.
- Local history and knowledge data are not encrypted in this release.
