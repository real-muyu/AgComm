// src/cli-signal.ts
var cliAbortController = new AbortController();
var cliInterrupted = false;
var stop = () => {
  cliInterrupted = true;
  cliAbortController.abort(new DOMException("Interrupted", "AbortError"));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

export {
  cliAbortController,
  cliInterrupted
};
