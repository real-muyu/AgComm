export const cliAbortController = new AbortController();
export let cliInterrupted = false;

const stop = () => {
  cliInterrupted = true;
  cliAbortController.abort(new DOMException("Interrupted", "AbortError"));
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

export function disposeCliSignals() {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
