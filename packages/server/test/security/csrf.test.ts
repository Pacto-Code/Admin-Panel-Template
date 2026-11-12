import { describe, expect, it } from "vitest";
import { CsrfService } from "../../src";
import { makeConfig } from "../fixtures";

const csrf = new CsrfService(makeConfig());

describe("CsrfService", () => {
  it("round-trips a token for the same session", () => expect(csrf.verify("s1", csrf.tokenFor("s1"))).toBe(true));
  it("rejects a token from another session", () => expect(csrf.verify("s2", csrf.tokenFor("s1"))).toBe(false));
  it("rejects tokens of the wrong length without throwing", () => {
    expect(csrf.verify("s1", "")).toBe(false);
    expect(csrf.verify("s1", "abc")).toBe(false);
    expect(csrf.verify("s1", csrf.tokenFor("s1") + "00")).toBe(false);
  });
  it("is a 64-char hex HMAC", () => expect(csrf.tokenFor("s1")).toMatch(/^[0-9a-f]{64}$/));
  it("depends on the session secret", () => {
    const base = makeConfig();
    const other = new CsrfService({ ...base, session: { ...base.session, secret: "another-secret-another-secret-0000" } });
    expect(other.tokenFor("s1")).not.toBe(csrf.tokenFor("s1"));
  });
});
