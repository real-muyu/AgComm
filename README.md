# AgComm

AgComm (Agent Command) is a TypeScript-first platform for building, running, and automating AI applications. Define flows, skills, workspaces, HTTP calls, CODE nodes, hooks, and background tasks with the SDK; package them as portable AgComm Beta 1 `.ai` files; and execute them locally with AgComm Runtime.

## Core Capabilities

- Typed builder for variables, templates, input forms, skills, workspaces, HTTP, conditions, CODE, and output nodes.
- Multi-turn conversations, optional local history, and app- or session-scoped knowledge retrieval.
- Portable plugins, Workspace Hooks, and Flow Hooks running in restricted Worker sandboxes.
- Gateway automation with Heartbeat, Cron, CONTACT, Inbox, and optional Webhook delivery.
- Text or full event streaming for the CLI, TUI, SDK Runner, and Gateway subscriptions.
- Local-first provider profiles, trust decisions, sessions, knowledge, and Gateway data.

## Quick Start

AgComm requires Node.js `>=22.13.0`.

Install the SDK and Runtime in your application project:

```bash
npm install @agcomm/ai-sdk @agcomm/ai-runtime
```

Runtime automatically installs the independent `@agcomm/gateway` control-plane package.

Build an application with the SDK:

```ts
import { defineApp, template, variable, writeAi } from "@agcomm/ai-sdk";

const request = variable.string("request");
const app = defineApp({ name: "Hello AgComm", variables: [request] }, ({ flow }) => {
  const form = flow.input({
    id: "request_form",
    fields: [{ variable: request, label: "Request", component: "input" }],
  });

  flow.output({
    id: "result",
    value: template`Received: ${request}`,
    after: form,
  });
});

await writeAi(app, "dist/hello.agcomm.ai");
```

Run the application:

```bash
OPENAI_API_KEY=sk-... agcomm dist/hello.agcomm.ai
```

In a full terminal, `agcomm open` provides a file launcher, provider profiles, package trust, sessions, knowledge, Gateway controls, Inbox, live flow state, and logs. Use `--batch`, `--headless`, or `--stream` for non-interactive workflows.

## Packages and Security

A `.ai` package contains only portable application declarations, resources, and bundled extensions. It does not contain API keys, OAuth tokens, user run history, or local credentials. Runtime stores API keys in the operating-system credential store and fails explicitly when secure credential storage is unavailable.

Plugin, CODE, and Hook bundles run in isolated Worker sandboxes. Runtime validates integrity, schemas, permissions, output size, timeouts, concurrency, and trust policy before execution. Unsigned bundles are rejected by default and require explicit authorization.

Session and knowledge data are isolated by the SHA-256 hash of the complete `.ai` bytes and are stored under `~/.agcomm/runtime/apps/<package-sha256>/` by default. Background applications are managed through current-user-only local Gateway IPC; no network control port is opened.

The SDK is licensed under MIT, Runtime under LGPL-3.0-only, and the independent Gateway control plane under Elastic License 2.0. Each npm package ships its own license and build output.

## Repository Layout

```text
packages/
|-- ai-sdk/       # @agcomm/ai-sdk: application definitions, builds, packages, and development Runner
|-- ai-runtime/   # @agcomm/ai-runtime: Node Runtime, CLI, and TUI
`-- gateway/      # @agcomm/gateway: scheduling, IPC, Inbox, and Webhook control plane
examples/
`-- ai-sdk-report/ # End-to-end Flow, CODE, Hook, conversation, knowledge, and background example
```

## Documentation

- [SDK README](./ai-sdk/README.md)
- [SDK Developer Guide](./ai-sdk/DEVELOPER.md)
- [Runtime README](./ai-runtime/README.md)
- [Runtime Usage Guide](./ai-runtime/USAGE.md)
- [Gateway README](./gateway/README.md)
- [Complete Example](./ai-sdk-report/README.md)
