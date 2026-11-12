import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run, withWorkspaceDependency } from "../src/run";
import { scaffoldModule } from "../src/scaffold";

// A throwaway workspace root, so the test never depends on (or touches) the real modules/ folder.
const root = mkdtempSync(join(tmpdir(), "create-module-"));
mkdirSync(join(root, "modules", "auth"), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("scaffoldModule", () => {
  it("scaffolds the expected files", () =>
    expect(scaffoldModule("example", "Example").map((f) => f.path).sort()).toEqual([
      "modules/example/admin/index.ts",
      "modules/example/admin/messages/en.json",
      "modules/example/api/index.ts",
      "modules/example/db/schema.ts",
      "modules/example/manifest.ts",
      "modules/example/package.json",
      "modules/example/test/contract.test.ts",
    ]));
  it("rejects an id that is not kebab-case", () => expect(() => scaffoldModule("My Module", "x")).toThrow("kebab-case"));
  it("prefixes the table, permission and route with the id", () => {
    const files = Object.fromEntries(scaffoldModule("gift-cards", "Gift cards").map((f) => [f.path, f.content]));
    expect(files["modules/gift-cards/db/schema.ts"]).toContain('pgTable("gift_cards_items"');
    expect(files["modules/gift-cards/manifest.ts"]).toContain('"gift-cards.item.read"');
    expect(files["modules/gift-cards/api/index.ts"]).toContain('@Controller("admin/gift-cards/items")');
    expect(JSON.parse(files["modules/gift-cards/package.json"]!).name).toBe("@modules/gift-cards");
    expect(Object.values(files).join("\n")).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe("run", () => {
  it("refuses to overwrite an existing module", async () =>
    await expect(run(["auth"], { root })).rejects.toThrow('Module "auth" already exists'));
  it("requires an id", async () => await expect(run([], { root })).rejects.toThrow("Usage"));
});

describe("withWorkspaceDependency", () => {
  it("adds the module to an app's dependencies, sorted, keeping other fields", () => {
    const before = JSON.stringify({ name: "api", dependencies: { "@platform/server": "workspace:*", "@nestjs/core": "^12" } });
    const after = withWorkspaceDependency(before, "@modules/gift-cards");
    expect(after.endsWith("}\n")).toBe(true);
    expect(JSON.parse(after)).toEqual({
      name: "api",
      dependencies: { "@modules/gift-cards": "workspace:*", "@nestjs/core": "^12", "@platform/server": "workspace:*" },
    });
    expect(Object.keys(JSON.parse(after).dependencies)[0]).toBe("@modules/gift-cards");
  });
  it("creates dependencies when there are none", () =>
    expect(JSON.parse(withWorkspaceDependency('{"name":"admin"}', "@modules/x")).dependencies).toEqual({
      "@modules/x": "workspace:*",
    }));
});
