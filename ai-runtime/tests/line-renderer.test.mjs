import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createLineRenderer } from "../dist/index.js";

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => { rendered += chunk; });
  return { input, output, rendered: () => rendered };
}

function request(signal, variables = { name: "default", enabled: false, settings: {}, action: "continue" }) {
  return {
    projectName: "Line project",
    node: { id: "input", title: "Configure" },
    form: { layout: "three-column", fields: [
      { id: "name", variable: "name", variableType: "string", label: "Name", component: "input", size: "large", placeholder: "your name" },
      { id: "enabled", variable: "enabled", variableType: "boolean", label: "Enabled", component: "checkbox", size: "small" },
      { id: "settings", variable: "settings", variableType: "object", label: "Settings", component: "input", size: "large" },
      { id: "continue", variable: "action", variableType: "string", label: "Continue", component: "button", size: "small", buttonValue: "continue" },
      { id: "stop", variable: "action", variableType: "string", label: "Stop", component: "button", size: "small", buttonValue: "stop" },
    ] },
    variables,
    signal,
  };
}

test("line renderer shows the whole form and reads ordinary fields followed by a numbered button", async () => {
  const io = streams();
  const renderer = createLineRenderer({ input: io.input, output: io.output });
  const controller = new AbortController();
  await renderer.start({ projectName: "Unsafe\u001b]52;c;secret\u0007", model: "fake", signal: controller.signal, cancel: (reason) => controller.abort(reason) });
  const pending = renderer.requestInput(request(controller.signal));
  await new Promise((resolve) => setImmediate(resolve));
  io.input.write("edited\nyes\n{\"mode\":\"safe\"}\n2\n");
  const values = await pending;
  assert.deepEqual(values, { name: "edited", enabled: true, settings: '{"mode":"safe"}', action: "stop" });
  assert.match(io.rendered(), /输入节点：Configure/);
  assert.match(io.rendered(), /提示：your name/);
  assert.match(io.rendered(), /1\. Continue/);
  assert.match(io.rendered(), /2\. Stop/);
  assert.doesNotMatch(io.rendered(), /secret/);
  await renderer.dispose();
});

test("line renderer accepts prefilled values with blank lines and retries invalid checkbox answers", async () => {
  const io = streams();
  const renderer = createLineRenderer({ input: io.input, output: io.output });
  const controller = new AbortController();
  const pending = renderer.requestInput(request(controller.signal));
  await new Promise((resolve) => setImmediate(resolve));
  io.input.write("\nmaybe\nn\n\n\n");
  const values = await pending;
  assert.deepEqual(values, { name: "default", enabled: false, settings: {}, action: "continue" });
  assert.match(io.rendered(), /请输入 y\/yes\/1\/true/);
  await renderer.dispose();
});

test("non-interactive line renderer accepts false, zero, and empty strings but rejects an unselected button group", async () => {
  const renderer = createLineRenderer({ interactive: false });
  const signal = new AbortController().signal;
  const complete = request(signal, { name: "", enabled: false, settings: {}, action: "stop", zero: 0 });
  assert.equal((await renderer.requestInput(complete)).enabled, false);
  await assert.rejects(
    renderer.requestInput(request(signal, { name: "", enabled: false, settings: {}, action: "unknown" })),
    (error) => error.code === "INPUT_VALUES_REQUIRED",
  );
});

test("line renderer aborts an active question", async () => {
  const io = streams();
  const renderer = createLineRenderer({ input: io.input, output: io.output });
  const controller = new AbortController();
  const pending = renderer.requestInput(request(controller.signal));
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new DOMException("Interrupted", "AbortError"));
  await assert.rejects(pending, /Interrupted|Abort/);
  await renderer.dispose();
});
