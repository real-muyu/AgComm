# @agcomm/ai-runtime

AgComm Runtime executes AgComm Beta 1 `.ai` applications through a Node.js API, the `agcomm` CLI, a full-screen TUI, and a local Gateway. It supports flow execution, INPUT checkpoints, multi-turn sessions, knowledge retrieval, streaming, package trust, host permissions, portable plugins, CODE, Workspace Hooks, Flow Hooks, Heartbeat, Cron, CONTACT, and Inbox.

The control plane is provided by the independent `@agcomm/gateway` package and is installed automatically with Runtime. Gateway APIs are exported only from `@agcomm/gateway`; the Runtime root entry exposes execution, providers, sessions, knowledge, TUI, and host-permission APIs.

## Quick Start

```bash
OPENAI_API_KEY=sk-... npx @agcomm/ai-runtime workflow.ai \
  --input "Summarize this" \
  --vars '{"language":"en"}'
```

```bash
agcomm workflow.ai --headless
agcomm workflow.ai --batch --input "hello"
agcomm workflow.ai --stream --input "hello"
agcomm workflow.ai --allow-unsigned-plugins --input "trusted local package"
agcomm open
```

A full terminal starts the built-in TUI. Use `--headless` for sequential text interaction and `--batch` for non-interactive JSON output. Every time a background-enabled application is opened in a full TTY, Runtime asks for approval. Approval installs the current-user Gateway login service and enables the app; rejection disables the app without deleting its data. The internal daemon entry is `agcomm gateway run` and listens only on authenticated current-user local IPC.

Provider defaults:

- `OPENAI_API_KEY`: required when Skill or Workspace nodes call a model.
- `OPENAI_BASE_URL`: defaults to `https://api.openai.com/v1`.
- `OPENAI_MODEL`: defaults to `gpt-4.1-mini`.
- `OPENAI_EMBEDDING_MODEL`: required when a knowledge-enabled app indexes or queries files.

See the [Runtime Usage Guide](./USAGE.md) for the full CLI and library reference.

## Library

```js
import { createRuntime, createTerminalRenderer, createHttpModelProvider } from "@agcomm/ai-runtime";

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
  const stream = await runtime.streamAiFile("workflow.ai", { mode: "text", input: "hello" });
  for await (const chunk of stream) process.stdout.write(chunk);
  await stream.result;

  const result = await runtime.runAiFile("workflow.ai", {
    input: "hello",
    variables: { language: "en" },
    renderer: createTerminalRenderer(),
  });
  console.log(result);
} finally {
  await runtime.dispose();
}
```

Use an application handle for persistent sessions and local knowledge. Storage is isolated by the SHA-256 hash of the complete `.ai` bytes:

```js
const app = await runtime.openAiApp("workflow.ai");
const session = await app.createSession({ title: "Release review" });
await app.importKnowledge(["./handbook.md"], { scope: { type: "app" } });
await session.runTurn("Check the release against the handbook");
console.log(await session.history());
await app.dispose();
```

## Security

The default data directory is `~/.agcomm/runtime/apps/<package-sha256>`. Knowledge indexing requires an `embeddingProvider` or OpenAI-compatible `embeddingModel`; Runtime never silently falls back to keyword search.

Runtime does not edit `.ai` files, start a browser or local HTTP server, or execute server plugins. Unsigned portable bundles are rejected by default. Enabling `allowUnsignedPlugins: true` or `--allow-unsigned-plugins` does not bypass integrity, schema, permission, output-size, or sandbox validation.
