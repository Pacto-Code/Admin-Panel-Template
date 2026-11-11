import { describe, expect, it } from "vitest";
import { validateManifest, type ModuleManifest } from "../src/index";

const audit: ModuleManifest = { id: "audit", name: "Audit", permissions: [{ key: "audit.entry.read", label: "View" }] };

describe("validateManifest", () => {
  it("accepts a valid manifest", () => expect(validateManifest(audit)).toEqual([]));
  it("rejects a non-kebab id", () =>
    expect(validateManifest({ ...audit, id: "Audit_Log" })).toContain('Module id "Audit_Log" must be kebab-case'));
  it("rejects a permission outside the module prefix", () =>
    expect(validateManifest({ ...audit, permissions: [{ key: "orders.entry.read", label: "x" }] }))
      .toContain('Permission "orders.entry.read" must start with "audit."'));
  it("rejects a nav item whose permission is not declared", () =>
    expect(validateManifest({ ...audit, nav: [{ label: "A", path: "/audit", icon: "list", permission: "audit.x.y", order: 1 }] }))
      .toContain('Nav item "/audit" uses undeclared permission "audit.x.y"'));
});
