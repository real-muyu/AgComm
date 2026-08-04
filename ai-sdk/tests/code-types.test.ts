import {
  defineApp,
  defineCode,
  defineFlowHook,
  defineSkill,
  defineWorkspaceHook,
  streamApp,
  type AiRunStream,
  type AiStreamEvent,
  type ContactReceipt,
  type NodeRef,
  variable,
} from "../src/index.ts";

type RegexInput = { text: string; options: { pattern: string } };
type RegexOutput = { matches: string[] };

const regex = defineCode<RegexInput, RegexOutput>({
  entry: import.meta.url,
  id: "regex",
  name: "Regex",
  description: "Extract matches",
  version: "1.0.0",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  run(input) { return { matches: [input.text] }; },
});

const text = variable.string("text");

defineApp({ name: "Types", variables: [text] }, ({ flow }) => {
  const result = flow.code({
    id: "extract",
    code: regex,
    input: { text, options: { pattern: "[A-Z]+" } },
  });
  const typed: NodeRef<RegexOutput> = result;
  void typed;

  // @ts-expect-error nested required input fields are checked.
  flow.code({ id: "invalid_input", code: regex, input: { text } });
  // @ts-expect-error CODE output retains the declared generic type.
  const wrong: NodeRef<string> = result;
  void wrong;
  flow.output({ id: "result", value: result });
});

defineApp({
  id: "background_types",
  version: "1.0.0",
  name: "Background Types",
  background: { heartbeat: { id: "monitor", everyMs: 60_000, input: "run" } },
}, ({ flow }) => {
  const receipt: NodeRef<ContactReceipt> = flow.contact({ id: "notify", title: "Notice", body: "Body", severity: "warning" });
  flow.output({ id: "result", value: receipt });
  // @ts-expect-error CONTACT severity is a closed union.
  flow.contact({ id: "invalid_severity", title: "Notice", body: "Body", severity: "urgent" });
});

type HookState = { calls: number };
const hook = defineWorkspaceHook<HookState>({
  entry: import.meta.url,
  id: "typed_hook",
  name: "Typed Hook",
  description: "Type inference fixture",
  version: "1.0.0",
  handlers: {
    onStart(event) {
      const calls: number = event.state?.calls ?? 0;
      return { input: event.input, variables: { local_count: calls }, state: { calls } };
    },
    beforeTool(event) {
      return { input: event.input, state: { calls: (event.state?.calls ?? 0) + 1 } };
    },
    onError(event) { void event.error.message; },
  },
});
const hookAgent = defineSkill({ id: "typed_agent", name: "Agent", prompt: "Coordinate" });
const hookChild = defineSkill({ id: "typed_child", name: "Child", prompt: "Execute" });
defineApp({ name: "Hook Types", skills: [hookAgent, hookChild] }, ({ flow }) => {
  const output = flow.workspace({ id: "typed_workspace", agent: hookAgent, skills: [hookChild], hooks: [hook] });
  flow.output({ id: "typed_output", value: output });
});

defineWorkspaceHook<HookState>({
  entry: import.meta.url,
  id: "invalid_typed_hook",
  name: "Invalid Hook",
  description: "Invalid state fixture",
  version: "1.0.0",
  handlers: {
    // @ts-expect-error Hook state retains the declared generic type.
    onStart() { return { state: { calls: "invalid" } }; },
  },
});

const flowHook = defineFlowHook<HookState>({
  entry: import.meta.url,
  id: "typed_flow_hook",
  name: "Typed Flow Hook",
  description: "Flow Hook type inference fixture",
  version: "1.0.0",
  handlers: {
    beforeNode(event) {
      const calls: number = event.state?.calls ?? 0;
      return { config: event.node.config, state: { calls: calls + 1 } };
    },
    onNodeError(event) {
      if (event.node.type === "HTTP") return { recoverWith: { status: 200 }, state: event.state };
    },
  },
});
defineApp({ name: "Flow Hook Types", hooks: [flowHook] }, ({ flow }) => {
  const result = flow.http({ id: "typed_http", url: "https://example.com" });
  flow.output({ id: "typed_flow_output", value: result });
});

defineFlowHook<HookState>({
  entry: import.meta.url,
  id: "invalid_typed_flow_hook",
  name: "Invalid Typed Flow Hook",
  description: "Invalid Flow Hook state fixture",
  version: "1.0.0",
  handlers: {
    // @ts-expect-error Flow Hook state retains the declared generic type.
    afterNode() { return { state: { calls: "invalid" } }; },
  },
});

const streamingApp = defineApp({
  name: "Streaming Types",
  interaction: { streaming: { defaultMode: "text" } },
}, ({ flow }) => flow.output({ id: "streaming_output", value: "done" }));

defineApp({
  name: "Invalid Streaming Types",
  // @ts-expect-error Streaming mode is limited to text or events.
  interaction: { streaming: { defaultMode: "tokens" } },
}, ({ flow }) => flow.output({ id: "invalid_streaming_output", value: "done" }));

async function streamTypes() {
  const textStream: AiRunStream<string> = await streamApp(streamingApp, { run: { mode: "text" } });
  const eventStream: AiRunStream<AiStreamEvent> = await streamApp(streamingApp, { run: { mode: "events" } });
  void textStream;
  void eventStream;
  // @ts-expect-error stream mode controls the yielded item type.
  const wrong: AiRunStream<string> = await streamApp(streamingApp, { run: { mode: "events" } });
  void wrong;
}
void streamTypes;
