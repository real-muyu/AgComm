# @agcomm/ai-sdk

A code-first AgComm (Agent Command) SDK for Node.js 22+ TypeScript projects. The current release generates AgComm Beta 1 `.ai` packages that run through `@agcomm/ai-runtime`, the `agcomm` CLI, or the SDK Runner. Beta 1 includes application-level Flow Hooks that can intercept standalone DAG nodes and recover after retries are exhausted.

See the [Developer Guide](./DEVELOPER.md) for the complete API, builder semantics, Runtime, sessions, knowledge, and plugin reference.

TypeScript control flow determines which nodes are generated at build time. Use `flow.condition()` for dynamic runtime branches and `flow.code()` for deterministic work that does not need a model. The SDK does not provide a loop DSL.

## Installation

Runtime and Gateway are peer dependencies of the SDK. Install the SDK and Runtime together; Runtime installs Gateway automatically:

```bash
npm install @agcomm/ai-sdk @agcomm/ai-runtime
```

Import Gateway APIs directly from `@agcomm/gateway` when you need to manage background applications yourself.

## Create an Application

```ts
import {
  defineApp,
  defineSkill,
  template,
  variable,
  writeAi,
} from "@agcomm/ai-sdk";

const userInput = variable.string("user_input");
const writer = defineSkill({
  id: "writer",
  name: "Writer",
  description: "Generate a concise report",
  category: "Content",
  prompt: "Write a concise report for {{skill_input}}.",
});

const app = defineApp({
  name: "Report App",
  interaction: {
    conversation: { history: true },
    knowledge: { enabled: true, scopes: ["app", "session"] },
    streaming: { defaultMode: "text" },
  },
  variables: [userInput],
  skills: [writer],
  visualizations: ["bar", "line"],
}, ({ flow }) => {
  const form = flow.input({
    id: "collect",
    fields: [{ variable: userInput, label: "Request", component: "input", size: "large" }],
  });
  const report = flow.skill({
    id: "write",
    skill: writer,
    input: userInput,
    output: "report",
    after: form,
  });
  flow.output({ id: "result", value: template`${report}` });
});

await writeAi(app, new URL("./dist/report.ai", import.meta.url));
```

Every node requires a stable explicit `id`. The builder infers edges from variable and output references. A node with no references defaults to the preceding node. `after` adds explicit dependencies, while `after: []` connects directly to START.

Available flow methods:

- `flow.input()`: one- to three-column forms with input, checkbox, and button controls.
- `flow.skill()`: invoke a declared Skill.
- `flow.workspace()`: let a manager Skill call allowlisted Skills autonomously.
- `flow.http()`: call a public HTTPS URL allowed by Runtime network policy.
- `flow.condition()`: evaluate a restricted Boolean expression and create branches with `whenTrue()` and `whenFalse()`.
- `flow.code()`: run a schema-validated TypeScript function in a restricted Worker.
- `flow.contact()`: write to Inbox in a Gateway background context and optionally enqueue a Webhook.
- `flow.output()`: return the final template or structured value.

```ts
const decision = flow.condition({
  id: "approve",
  expression: template`${score} >= 0.7`,
});
flow.skill({ id: "accepted", skill: writer, after: decision.whenTrue() });
flow.skill({ id: "rejected", skill: reviewer, after: decision.whenFalse() });
```

`conversation.history: true` enables both multi-turn context and local persistence. With only `multiTurn: true`, history remains in the current process. Session-scoped knowledge requires persistent history. Local data is isolated by the final `.ai` byte hash, so a rebuilt package cannot read another package's data.

`compileApp()` returns an inspectable `FlowProject`, `buildAi()` returns a `Uint8Array`, and `writeAi()` atomically writes a package after round-trip validation.

## Streaming

Declare `interaction.streaming.defaultMode` as `"text"` or `"events"`. The default is `"text"`, and a per-run `mode` takes precedence. Text streams contain only content consistent with the final OUTPUT. Event streams also include model context, Flow, Tool, Hook and Plugin Log events, `output-delta`, and exactly one `result` or `error`.

```ts
import { streamApp } from "@agcomm/ai-sdk";

const stream = await streamApp(app, {
  runtime: { provider },
  run: { mode: "text", input: "Generate the weekly report" },
});

for await (const chunk of stream) process.stdout.write(chunk);
const result = await stream.result;
```

`runner.stream()`, `appHandle.stream()`, `session.streamTurn()`, and Runtime `streamAiFile()` use the same `AiRunStream<T>` contract. Calling `cancel()` or leaving `for await` early cancels the run. A stream allows one consumer. Ordinary `run()` still returns `AiRunResult` and can receive the same data through `onOutputDelta` and `onStreamEvent`.

## Background Services

A background application requires a stable `id`, `version`, and at least one Heartbeat or Cron trigger:

```ts
const app = defineApp({
  id: "daily_assistant",
  version: "1.0.0",
  name: "Daily Assistant",
  background: {
    heartbeat: { id: "monitor", everyMs: 15 * 60_000, input: "Check for pending tasks" },
    cron: [{ id: "morning", expression: "0 9 * * 1-5", timezone: "Asia/Shanghai", input: "Generate the work summary" }],
  },
}, ({ flow }) => {
  const receipt = flow.contact({
    id: "notify",
    title: "Action required",
    body: "Review today's summary",
    severity: "warning",
    webhook: true,
    dedupeKey: "daily-report",
  });
  flow.output({ id: "result", value: receipt });
});
```

Every full-TTY invocation of `agcomm app.ai` shows triggers, package hash, bundle permissions, and the Webhook data scope. The current-user Gateway is installed or enabled only after approval. Rejection disables the app with the same ID. `--headless`, `--batch`, `--json`, and non-TTY runs never install or enable background services.

## TypeScript CODE

Place each CODE function in an independent entry file and provide both generics and runtime schemas:

```ts
import { defineCode } from "@agcomm/ai-sdk/code";

export default defineCode<{ text: string }, { normalized: string }>({
  entry: import.meta.url,
  id: "normalize_text",
  name: "Normalize Text",
  description: "Normalize whitespace",
  version: "1.0.0",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  outputSchema: { type: "object", properties: { normalized: { type: "string" } }, required: ["normalized"], additionalProperties: false },
  run(input, context) {
    context.checkAborted();
    return { normalized: input.text.replace(/\s+/g, " ").trim() };
  },
});
```

The SDK uses esbuild to produce a single browser-targeted ESM file. CODE reuses plugin integrity, signature, permission, and Worker sandbox enforcement. Unsigned CODE and plugins share the `allowUnsignedPlugins` and `--allow-unsigned-plugins` trust controls.

## Workspace Hooks

A Workspace Hook must be an independent entry file with a default `defineWorkspaceHook()` export:

```ts
import { defineWorkspaceHook } from "@agcomm/ai-sdk/hook";

export default defineWorkspaceHook<{ calls: number }>({
  entry: import.meta.url,
  id: "workspace_policy",
  name: "Workspace Policy",
  description: "Normalize Workspace calls",
  version: "1.0.0",
  handlers: {
    onStart(event) {
      return { input: event.input.trim(), variables: { normalized: true }, state: { calls: 0 } };
    },
    beforeTool(event) {
      return { input: event.input, state: { calls: (event.state?.calls ?? 0) + 1 } };
    },
    onFinish(event) {
      return { output: event.output, state: event.state };
    },
  },
});
```

Attach hooks with `flow.workspace({ hooks: [workspacePolicy] })`. Available stages are `onStart`, `beforeModel`, `afterModel`, `beforeTool`, `afterTool`, `onFinish`, and `onError`. Hook state exists only for that Workspace execution. Variable patches remain local to the Workspace and cannot overwrite Runtime-reserved or DAG-global variables. Returning `skipWith` from `beforeTool` bypasses the actual tool.

## Flow Hooks

Use an application-level Flow Hook for standalone DAG nodes and attach it through `defineApp({ hooks: [...] })`:

```ts
import { defineFlowHook } from "@agcomm/ai-sdk/flow-hook";

export default defineFlowHook({
  entry: import.meta.url,
  id: "http_policy",
  name: "HTTP Policy",
  description: "Normalize HTTP requests",
  version: "1.0.0",
  handlers: {
    beforeNode(event) {
      if (event.node.type !== "HTTP") return;
      return { config: { ...event.node.config, url: String(event.node.config.url).replace("region=APAC", "region=global") } };
    },
    onNodeError(event) {
      if (event.node.id === "optional_http") return { recoverWith: { status: 200, headers: {}, body: null } };
    },
  },
});
```

`beforeNode` runs before every attempt, `onNodeError` runs after node retries are exhausted, and `afterNode` handles the final success, skip, or recovered value. Without `recoverWith`, the original error still terminates the DAG. Modified HTTP requests are revalidated by Runtime network policy.

## Portable Plugins

Use an independent plugin entry file so esbuild can collect local modules and third-party dependencies without serializing closures:

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

Add the default plugin export to `defineSkill({ plugins: [...] })`. Beta 1 produces portable bundles with `runtime: "runtime"`.

SDK-generated plugin and CODE bundles are unsigned. Runtime rejects them by default, so explicitly opt in only for trusted local packages:

```ts
await runApp(app, {
  runtime: {
    provider,
    allowUnsignedPlugins: true,
  },
  run: { input: "hello" },
});
```

The CLI equivalent is `agcomm app.ai --allow-unsigned-plugins`. This option does not disable schema, integrity, permission, output-size, or Worker sandbox checks.

## Development Runs

```ts
import { createAppRunner, runApp } from "@agcomm/ai-sdk";

const once = await runApp(app, { run: { input: "one" } });

const runner = await createAppRunner(app, { provider });
try {
  const stream = runner.stream({ mode: "events", input: "streamed" });
  for await (const event of stream) console.log(event.type, event.sequence);
  await stream.result;

  const session = await runner.createSession();
  await session.runTurn("two");
  await session.runTurn("three");
  await runner.importKnowledge(["./handbook.md"], { scope: { type: "app" } });
} finally {
  await runner.dispose();
}
```

Every run API first builds real `.ai` bytes and then passes them to Runtime for parsing and execution. Development runs and final packages therefore use the same execution path.
