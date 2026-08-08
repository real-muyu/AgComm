import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { installActiveHandleDiagnostics } from "../../test-utils/active-handles.mjs";
import { createTerminalRenderer } from "../dist/index.js";

installActiveHandleDiagnostics("ai-runtime/terminal-renderer");

function terminals(columns = 100, rows = 30) {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = columns;
  output.rows = rows;
  let screen = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => { screen += chunk; });
  return { input, output, screen: () => screen };
}

function lastFrame(screen) {
  return screen.split("\u001b[H\u001b[2J").at(-1) ?? screen;
}

function key(input, name, options = {}, text = "") {
  input.emit("keypress", text, { name, sequence: text, ctrl: false, meta: false, shift: false, ...options });
}

test("terminal renderer edits form controls, sanitizes terminal sequences, and restores terminal state", async () => {
  const terminal = terminals();
  const renderer = createTerminalRenderer({ input: terminal.input, output: terminal.output, color: false });
  const controller = new AbortController();
  await renderer.start({ projectName: "Unsafe\u001b]52;c;payload\u0007 Project", model: "fake", signal: controller.signal, cancel: (reason) => controller.abort(reason) });
  const pending = renderer.requestInput({
    projectName: "Project", node: { id: "input", title: "Input" }, layout: "single",
    form: { layout: "three-column", fields: [
      { id: "text", variable: "text", variableType: "string", label: "Text", component: "input", size: "large", placeholder: "type" },
      { id: "check", variable: "check", variableType: "boolean", label: "Check", component: "checkbox", size: "small" },
      { id: "button", variable: "button", variableType: "number", label: "Button", component: "button", size: "small", buttonValue: "5" },
    ] },
    variables: { text: "", check: false, button: 0 }, signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  terminal.input.write("\rhi\r\t \t\r\t\r");
  const values = await pending;
  assert.deepEqual(values, { text: "hi", check: true, button: "5" });
  const completing = renderer.complete({ status: "completed", output: "done\u001b[31m unsafe", elapsedMs: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  terminal.input.write("q");
  await completing;
  await renderer.dispose();
  assert.equal(terminal.input.isRaw, false);
  assert.match(terminal.screen(), /\u001b\[\?1049h/);
  assert.match(terminal.screen(), /\u001b\[\?1049l/);
  assert.doesNotMatch(terminal.screen(), /payload/);
  assert.doesNotMatch(terminal.screen(), /\u001b\[31m unsafe/);
});

test("terminal renderer collapses narrow layouts and aborts input on Ctrl+C", async () => {
  const terminal = terminals(50, 16);
  const controller = new AbortController();
  const renderer = createTerminalRenderer({ input: terminal.input, output: terminal.output, color: false });
  await renderer.start({ projectName: "Narrow", model: "fake", signal: controller.signal, cancel: (reason) => controller.abort(reason) });
  const pending = renderer.requestInput({
    projectName: "Narrow", node: { id: "input", title: "Input" },
    form: { layout: "three-column", fields: [
      { id: "a", variable: "a", variableType: "string", label: "A", component: "input", size: "small" },
      { id: "b", variable: "b", variableType: "string", label: "B", component: "input", size: "small" },
    ] },
    variables: { a: "", b: "" }, signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  terminal.input.write("\u0003");
  await assert.rejects(pending, /Interrupted|Abort/);
  await renderer.dispose();
  assert.equal(terminal.input.isRaw, false);
});

test("terminal renderer uses black background, teal true-color accent, and renders streaming output", async () => {
  const previous = process.env.COLORTERM;
  process.env.COLORTERM = "truecolor";
  try {
    const terminal = terminals();
    const renderer = createTerminalRenderer({ input: terminal.input, output: terminal.output, color: true });
    const controller = new AbortController();
    await renderer.start({ projectName: "Premium", model: "fake-model", signal: controller.signal, cancel: (reason) => controller.abort(reason) });
    renderer.onStreamEvent({ type: "output-delta", text: "streamed response", nodeId: "output", sequence: 1, at: new Date().toISOString() });
    assert.match(terminal.screen(), /\u001b\[48;2;0;0;0m/);
    assert.match(lastFrame(terminal.screen()), /\u001b\[38;2;32;178;170m/);
    assert.match(lastFrame(terminal.screen()), /Response/);
    assert.match(lastFrame(terminal.screen()), /streamed response/);
    await renderer.dispose();
  } finally {
    if (previous === undefined) delete process.env.COLORTERM;
    else process.env.COLORTERM = previous;
  }
});

test("terminal renderer commits multiline input and submits with Ctrl+Enter", async () => {
  const terminal = terminals();
  const renderer = createTerminalRenderer({ input: terminal.input, output: terminal.output, color: false });
  const controller = new AbortController();
  await renderer.start({ projectName: "Keyboard", model: "fake", signal: controller.signal, cancel: (reason) => controller.abort(reason) });
  const pending = renderer.requestInput({
    projectName: "Keyboard", node: { id: "input", title: "Compose" },
    form: { layout: "single", fields: [
      { id: "notes", variable: "notes", variableType: "markdown", label: "Notes", component: "input", size: "large" },
    ] },
    variables: { notes: "" }, signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  key(terminal.input, "return", { sequence: "\r" }, "\r");
  terminal.input.write("first");
  key(terminal.input, "return", { sequence: "\r" }, "\r");
  terminal.input.write("second");
  key(terminal.input, "return", { ctrl: true, sequence: "\n" }, "\n");
  assert.deepEqual(await pending, { notes: "first\nsecond" });
  await renderer.dispose();
});

test("terminal renderer keeps F10 submission compatible and scrolls focused fields into view", async () => {
  const terminal = terminals(52, 12);
  const renderer = createTerminalRenderer({ input: terminal.input, output: terminal.output, color: false });
  const controller = new AbortController();
  await renderer.start({ projectName: "Long Form", model: "fake", signal: controller.signal, cancel: (reason) => controller.abort(reason) });
  const fields = Array.from({ length: 8 }, (_, index) => ({
    id: `field-${index}`,
    variable: `field_${index}`,
    variableType: "string",
    label: `Field ${index}`,
    component: "input",
    size: "small",
  }));
  const variables = Object.fromEntries(fields.map((field) => [field.variable, ""]));
  const pending = renderer.requestInput({
    projectName: "Long Form", node: { id: "input", title: "Details" },
    form: { layout: "three-column", fields }, variables, signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  for (let index = 0; index < fields.length - 1; index++) key(terminal.input, "down");
  const frame = lastFrame(terminal.screen());
  assert.match(frame, /Field 7/);
  assert.match(frame, /↑ 更多字段/);
  key(terminal.input, "f10");
  assert.deepEqual(await pending, variables);
  await renderer.dispose();
});

test("terminal renderer replaces timers and removes AbortSignal listeners on disposal", async () => {
  const terminal = terminals();
  const renderer = createTerminalRenderer({ input: terminal.input, output: terminal.output, color: false });
  const controller = new AbortController();
  const context = { projectName: "Lifecycle", model: "fake", signal: controller.signal, cancel: () => {} };
  await renderer.start(context);
  await renderer.start(context);
  const pending = renderer.requestInput({
    projectName: "Lifecycle", node: { id: "input", title: "Input" },
    form: { layout: "single", fields: [{ id: "value", variable: "value", variableType: "string", label: "Value", component: "input", size: "small" }] },
    variables: { value: "" }, signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  controller.abort(new DOMException("test cleanup", "AbortError"));
  await assert.rejects(pending, /test cleanup|Abort/i);
  await renderer.dispose();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
