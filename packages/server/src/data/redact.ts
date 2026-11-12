export const DEFAULT_SENSITIVE = ["password", "passwordHash", "token", "tokenHash", "secret", "mfaSecret", "codeHash"];

const REDACTED = "[redacted]";

// `passwordHash` and the raw column name `password_hash` must both match.
const normalize = (key: string) => key.replaceAll("_", "").toLowerCase();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Returns a deep copy with every sensitive key's value replaced by "[redacted]". Dates and other instances pass through. */
export function redact(value: unknown, extraKeys: string[] = []): unknown {
  const keys = new Set([...DEFAULT_SENSITIVE, ...extraKeys].map(normalize));
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isPlainObject(v)) return v;
    return Object.fromEntries(Object.entries(v).map(([k, inner]) => [k, keys.has(normalize(k)) ? REDACTED : walk(inner)]));
  };
  return walk(value);
}
