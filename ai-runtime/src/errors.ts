export class AiRuntimeError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiRuntimeError";
  }
}
