/** A deliberate, client-visible error. Carries the code, status and per-field messages. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}
