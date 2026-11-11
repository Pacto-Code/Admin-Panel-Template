import { describe, expect, it } from "vitest";
import { loadConfig } from "../src";
import { catchError, prod, store } from "./fixtures";

describe("production guards", () => {
  it("boots production with real providers", () => {
    const c = loadConfig({ env: prod, store });
    expect(c.env).toBe("production");
    expect(c.email.provider).toBe("smtp");
    expect(c.storage.provider).toBe("s3");
    expect(c.errorTracking).toEqual({ provider: "sentry", dsn: "https://d" });
  });
  it.each([
    [{ providers: { email: "capture" } }, "providers.email"],
    [{ providers: { email: "mailpit" } }, "providers.email"],
    [{ providers: { storage: "local" } }, "providers.storage"],
  ] as const)("production rejects %j", (override, path) =>
    expect(catchError(() => loadConfig({ env: prod, store: { ...store, ...override } })).issues[0].path).toBe(path));
  it("production rejects a missing SMTP password", () =>
    expect(catchError(() => loadConfig({ env: { ...prod, SMTP_PASSWORD: undefined }, store })).issues.map((i) => i.path)).toContain(
      "SMTP_PASSWORD",
    ));
  it("requires S3 and Sentry variables", () => {
    const err = catchError(() =>
      loadConfig({ env: { ...prod, S3_BUCKET: undefined, SENTRY_DSN: undefined }, store }),
    );
    expect(err.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["S3_BUCKET", "SENTRY_DSN"]));
  });
});
