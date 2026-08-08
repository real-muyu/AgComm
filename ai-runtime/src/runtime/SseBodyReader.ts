import { AiRuntimeError } from "../errors.ts";

export class SseBodyReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private total = 0;

  constructor(response: Response, private readonly signal: AbortSignal, private readonly maximum: number) {
    if (!response.body) throw new AiRuntimeError("HTTP_SSE_INVALID", "Provider SSE response has no body");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximum) throw new AiRuntimeError("HTTP_RESPONSE_TOO_LARGE", "Provider response exceeds 4 MiB");
    this.reader = response.body.getReader();
  }

  async read() {
    if (this.signal.aborted) throw this.signal.reason ?? new DOMException("Aborted", "AbortError");
    let abort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(this.signal.reason ?? new DOMException("Aborted", "AbortError"));
      this.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await Promise.race([this.reader.read(), aborted]);
      this.total += result.value?.byteLength ?? 0;
      if (this.total > this.maximum) { await this.reader.cancel("response too large"); throw new AiRuntimeError("HTTP_RESPONSE_TOO_LARGE", "Provider response exceeds 4 MiB"); }
      return result;
    } finally {
      if (abort) this.signal.removeEventListener("abort", abort);
    }
  }

  cancel(reason: unknown) { return this.reader.cancel(reason); }
  async close() {
    if (this.signal.aborted) await this.reader.cancel(this.signal.reason).catch(() => undefined);
    this.reader.releaseLock();
  }
}
