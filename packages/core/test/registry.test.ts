import { describe, expect, it } from "vitest";
import { ModuleRegistry, defineManifest, defineStore, ModuleConfigError, type ModuleManifest } from "../src/index";

const a: ModuleManifest = {
  id: "a", name: "A", permissions: [{ key: "a.x.read", label: "R" }],
  nav: [{ label: "Two", path: "/two", icon: "i", permission: "a.x.read", order: 2 }],
};
const b: ModuleManifest = {
  id: "b", name: "B", permissions: [{ key: "b.x.read", label: "R" }],
  nav: [{ label: "One", path: "/one", icon: "i", permission: "b.x.read", order: 1 }],
};

describe("ModuleRegistry", () => {
  const reg = new ModuleRegistry([a, b]);
  it("looks modules up", () => {
    expect(reg.all()).toHaveLength(2);
    expect(reg.get("a")).toBe(a);
    expect(reg.has("zzz")).toBe(false);
  });
  it("lists permission keys", () => expect(reg.permissionKeys()).toEqual(["a.x.read", "b.x.read"]));
  it("sorts nav by order and tags the module", () =>
    expect(reg.nav().map((n) => [n.path, n.moduleId])).toEqual([["/one", "b"], ["/two", "a"]]));
});

describe("defineManifest / defineStore", () => {
  it("throws ModuleConfigError on an invalid manifest", () =>
    expect(() => defineManifest({ ...a, id: "Bad" })).toThrow(ModuleConfigError));
  it("returns a valid manifest", () => expect(defineManifest(a)).toBe(a));
  it("returns the store config", () => {
    const c = { modules: {}, branding: { name: "x", primaryColor: "#000" }, locale: { default: "en", currency: "USD", timezone: "UTC" } };
    expect(defineStore(c)).toBe(c);
  });
});
