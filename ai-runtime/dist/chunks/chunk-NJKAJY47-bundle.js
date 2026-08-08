// src/cli-signal.ts
var cliAbortController = new AbortController();
var cliInterrupted = false;
var stop = () => {
  cliInterrupted = true;
  cliAbortController.abort(new DOMException("Interrupted", "AbortError"));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
function disposeCliSignals() {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}

export {
  cliAbortController,
  cliInterrupted,
  disposeCliSignals
};
