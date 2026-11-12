import { describe, expect, it } from "vitest";
import { loadConfig } from "../src";
import { base, catchError, prod, store } from "./fixtures";

describe("loadConfig", () => {
  it("applies development defaults", () => {
    const c = loadConfig({ env: { ...base, APP_ENV: "development" }, store });
    expect(c.email).toMatchObject({ provider: "mailpit", smtp: { host: "localhost", port: 1025 } });
    expect(c.storage.provider).toBe("local");
    expect(c.apiDocs).toBe(true);
    expect(c.port).toBe(4000);
    expect(c.logLevel).toBe("debug");
  });
  it("applies demo defaults", () => {
    const c = loadConfig({ env: { ...base, APP_ENV: "demo" }, store });
    expect(c.email.provider).toBe("capture");
    expect(c.demo).toEqual({ oneClickLogin: true, lockRiskySettings: true, resetCron: "0 */6 * * *" });
  });
  it("lets store.config override a provider", () =>
    expect(
      loadConfig({ env: { ...base, APP_ENV: "development" }, store: { ...store, providers: { email: "capture" } } }).email.provider,
    ).toBe("capture"));
  it("names every missing variable at once", () => {
    const err = catchError(() => loadConfig({ env: { APP_ENV: "development" }, store }));
    expect(err.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["DATABASE_URL", "SESSION_SECRET", "ENCRYPTION_KEY"]));
  });
  it("rejects a short session secret", () =>
    expect(() => loadConfig({ env: { ...base, APP_ENV: "development", SESSION_SECRET: "short" }, store })).toThrow("SESSION_SECRET"));
  it("rejects an encryption key that is not 32 bytes", () => {
    const err = catchError(() =>
      loadConfig({ env: { ...base, APP_ENV: "development", ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }, store }),
    );
    expect(err.issues.map((i) => i.path)).toContain("ENCRYPTION_KEY");
  });
  it("rejects an unknown APP_ENV", () =>
    expect(catchError(() => loadConfig({ env: { ...base, APP_ENV: "qa" }, store })).issues[0].path).toBe("APP_ENV"));
  it("reads PORT and LOG_LEVEL", () => {
    const c = loadConfig({ env: { ...base, APP_ENV: "development", PORT: "5000", LOG_LEVEL: "warn" }, store });
    expect(c.port).toBe(5000);
    expect(c.logLevel).toBe("warn");
  });
  it("throws on missing audit entries everywhere except production, where it logs", () => {
    const mode = (APP_ENV: string, extra: Record<string, string> = {}) =>
      loadConfig({ env: { ...base, ...extra, APP_ENV }, store }).auditEnforcement;
    expect(mode("demo")).toBe("throw");
    expect(mode("development")).toBe("throw");
    expect(mode("staging", prod)).toBe("throw");
    expect(mode("production", prod)).toBe("log");
  });
  it("formats the message as path: message lines", () =>
    expect(catchError(() => loadConfig({ env: { APP_ENV: "development" }, store })).message).toMatch(/DATABASE_URL: .+/));
});
