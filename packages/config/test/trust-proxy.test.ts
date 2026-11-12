import { describe, expect, it } from "vitest";
import { loadConfig } from "../src";
import { base, catchError, store } from "./fixtures";

const trustProxy = (TRUST_PROXY?: string) =>
  loadConfig({ env: { ...base, APP_ENV: "development", TRUST_PROXY }, store }).trustProxy;

describe("TRUST_PROXY", () => {
  it("defaults to not trusting any proxy", () => {
    expect(trustProxy()).toBe(false);
    expect(trustProxy("")).toBe(false);
    expect(trustProxy("false")).toBe(false);
  });
  it("reads a hop count", () => {
    expect(trustProxy("1")).toBe(1);
    expect(trustProxy("2")).toBe(2);
  });
  it("reads a comma-separated list of addresses and CIDR ranges", () =>
    expect(trustProxy("10.0.0.0/8, 192.168.1.1,fd00::/8,loopback")).toBe("10.0.0.0/8,192.168.1.1,fd00::/8,loopback"));
  it.each(["true", "-1", "1.5", "proxy.example.com", "10.0.0.0/8,,", "10.0.0.0/8, nope"])("rejects %s", (value) =>
    expect(catchError(() => trustProxy(value)).issues.map((i) => i.path)).toContain("TRUST_PROXY"));
});
