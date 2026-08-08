import assert from "node:assert/strict";
import test from "node:test";
import { SessionPickerController } from "../src/tui/SessionPickerController.ts";

function session(id) {
  return { id, title: id, async history() { return []; }, async runTurn() {}, streamTurn() {}, async rename() {}, async dispose() {} };
}

function fixture(commands, prompt = "") {
  const calls = [];
  const existing = session("one");
  const app = {
    name: "Sessions",
    async listSessions() { return [{ id: "one", title: "One", messageCount: 2, createdAt: "", updatedAt: "" }]; },
    async createSession() { calls.push("create"); return session("new"); },
    async openSession(id) { calls.push(`open:${id}`); return existing; },
    async deleteSession(id) { calls.push(`delete:${id}`); },
  };
  const screen = {
    paint() {},
    async key() { const command = commands.shift(); return { text: command?.text, key: command?.key ?? {} }; },
    async prompt() { return prompt; },
  };
  return { app, screen, calls, existing };
}

test("session picker creates a session and exits", async () => {
  const created = fixture([{ key: { name: "return" } }]);
  assert.equal((await new SessionPickerController().run(created.screen, created.app)).id, "new");
  assert.deepEqual(created.calls, ["create"]);
  const exited = fixture([{ text: "q" }]);
  assert.equal(await new SessionPickerController().run(exited.screen, exited.app), undefined);
});

test("session picker selects, renames, and deletes an existing session", async () => {
  const opened = fixture([{ key: { name: "down" } }, { key: { name: "return" } }]);
  assert.equal((await new SessionPickerController().run(opened.screen, opened.app)).id, "one");
  assert.deepEqual(opened.calls, ["open:one"]);

  const renamed = fixture([{ key: { name: "down" } }, { text: "r" }, { text: "q" }], "Renamed");
  renamed.existing.rename = async (title) => renamed.calls.push(`rename:${title}`);
  renamed.existing.dispose = async () => renamed.calls.push("dispose");
  await new SessionPickerController().run(renamed.screen, renamed.app);
  assert.deepEqual(renamed.calls, ["open:one", "rename:Renamed", "dispose"]);

  const deleted = fixture([{ key: { name: "down" } }, { text: "d" }, { text: "q" }]);
  await new SessionPickerController().run(deleted.screen, deleted.app);
  assert.deepEqual(deleted.calls, ["delete:one"]);
});
