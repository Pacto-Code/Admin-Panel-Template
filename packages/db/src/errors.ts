/** Thrown when an optimistic-lock update matched no row (stale version). */
export class ConflictError extends Error {
  constructor(message = "The record was modified by someone else") {
    super(message);
    this.name = "ConflictError";
  }
}

/** Returns the first updated row, or throws ConflictError when none matched. */
export function expectUpdated<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new ConflictError();
  return row;
}
