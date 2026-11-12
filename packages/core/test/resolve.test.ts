import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveModules, type ModuleManifest } from "../src/index";

const a: ModuleManifest = { id: "a", name: "A", core: true, permissions: [] };
const b: ModuleManifest = { id: "b", name: "B", dependsOn: ["a"], permissions: [] };

describe("resolveModules", () => {
  it("orders dependencies first", () =>
    expect(resolveModules({ b: {}, a: {} }, { a, b }).map((m) => m.id)).toEqual(["a", "b"]));
  it("names an unknown module", () =>
    expect(() => resolveModules({ a: {}, zzz: {} }, { a })).toThrow('Unknown module "zzz"'));
  it("names a missing dependency", () =>
    expect(() => resolveModules({ b: {} }, { a: { ...a, core: false }, b })).toThrow('Module "b" requires "a", which is not enabled'));
  it("requires core modules", () =>
    expect(() => resolveModules({}, { a })).toThrow('Core module "a" must be enabled'));
  it("detects a cycle", () =>
    expect(() => resolveModules({ a: {}, b: {} }, { a: { ...a, dependsOn: ["b"] }, b })).toThrow("Dependency cycle"));
  it("validates options against the module schema", () =>
    expect(() => resolveModules({ a: { retentionDays: "x" } },
      { a: { ...a, options: z.object({ retentionDays: z.number() }) } })).toThrow('Module "a" option "retentionDays"'));
});
