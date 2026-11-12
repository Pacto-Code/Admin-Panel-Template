import { describe, expect, it } from "vitest";
import { DEFAULT_SENSITIVE, redact } from "../../src";

describe("redact", () => {
  it("redacts default and extra sensitive keys at any depth", () =>
    expect(redact({ email: "a", passwordHash: "h", nested: { token: "t", pin: "1" } }, ["pin"])).toEqual({
      email: "a",
      passwordHash: "[redacted]",
      nested: { token: "[redacted]", pin: "[redacted]" },
    }));

  it("matches snake_case column names and walks arrays", () =>
    expect(redact([{ password_hash: "h", mfa_secret: "m", name: "n" }])).toEqual([
      { password_hash: "[redacted]", mfa_secret: "[redacted]", name: "n" },
    ]));

  it("leaves dates, nulls and primitives alone and does not mutate the input", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const input = { at, none: null, n: 1, secret: "x" };
    expect(redact(input)).toEqual({ at, none: null, n: 1, secret: "[redacted]" });
    expect(input.secret).toBe("x");
    expect(redact(null)).toBeNull();
    expect(redact("plain")).toBe("plain");
  });

  it("lists the default keys", () => expect(DEFAULT_SENSITIVE).toContain("passwordHash"));
});
