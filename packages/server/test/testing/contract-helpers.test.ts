import "reflect-metadata";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Controller, Delete, Get, Module, Post, forwardRef, type Type } from "@nestjs/common";
import { afterAll, describe, expect, it } from "vitest";
import type { ModuleManifest } from "@platform/core";
import { Public, RequirePermission } from "../../src";
import {
  createdTables,
  moduleRoutes,
  undeclaredPermissions,
  unguardedRoutes,
  unprefixedTables,
  type TestModule,
} from "../../src/testing";

@Controller("admin/dep")
class DepController {
  @Public()
  @Get()
  list() {}
}
@Module({ controllers: [DepController] })
class DepModule {}

@Controller("admin/a/sub")
class SubController {
  @RequirePermission("a.sub.delete")
  @Delete(":id")
  remove() {}
}
@Module({ controllers: [SubController] })
class SubModule {}

@Controller("admin/a/items")
class ItemsController {
  @RequirePermission("a.item.read")
  @Get()
  list() {}
  @Public()
  @Post("ping")
  ping() {}
}
@Module({
  imports: [DepModule, forwardRef(() => SubModule), { module: class Dyn {}, controllers: [] }],
  controllers: [ItemsController],
})
class AModule {}

it("lists the routes of a module and its own imports, but not of its dependencies", () =>
  expect(moduleRoutes(AModule, [DepModule])).toEqual([
    { method: "GET", path: "/api/v1/admin/a/items", permission: "a.item.read", guarded: true },
    { method: "POST", path: "/api/v1/admin/a/items/ping", permission: undefined, guarded: true },
    { method: "DELETE", path: "/api/v1/admin/a/sub/:id", permission: "a.sub.delete", guarded: true },
  ]));

// A module that breaks the contract: an undecorated route and a permission its manifest does not declare.
@Public()
@Controller("admin/b/open")
class ClassGuardedController {
  @Get()
  list() {}
}
@Controller("admin/b/items")
class BadController {
  @Get("bare")
  bare() {}
  @RequirePermission("b.item.delete")
  @Delete(":id")
  remove() {}
  @RequirePermission("b.item.read")
  @Get()
  list() {}
}
@Controller("admin/dep-bare")
class DepBareController {
  @Get()
  bare() {}
}
@Module({ controllers: [DepBareController] })
class DepBareModule {}
@Module({ imports: [DepBareModule], controllers: [BadController, ClassGuardedController] })
class BModule {}

const testModule = (id: string, apiModule: Type, permissions: string[], migrationsFolder = ""): TestModule => ({
  id,
  apiModule,
  migrationsFolder,
  manifest: { id, name: id, permissions: permissions.map((key) => ({ key, label: key })) } satisfies ModuleManifest,
});
const b = testModule("b", BModule, ["b.item.read"]);
const dep = testModule("dep", DepBareModule, []);

describe("contract helpers flag violations", () => {
  it("flags an undecorated route, not class-guarded routes or a dependency's routes", () =>
    expect(unguardedRoutes(b, [dep])).toEqual(["GET /api/v1/admin/b/items/bare"]));
  it("flags a @RequirePermission key the manifest does not declare", () =>
    expect(undeclaredPermissions(b, [dep])).toEqual(['DELETE /api/v1/admin/b/items/:id requires "b.item.delete"']));
  it("passes a module that declares its keys and guards its routes", () => {
    expect(unguardedRoutes(testModule("a", AModule, []), [testModule("dep", DepModule, [])])).toEqual([]);
    expect(undeclaredPermissions(testModule("a", AModule, ["a.item.read", "a.sub.delete"]))).toEqual([]);
  });
});

describe("createdTables", () => {
  it("reads quoted, unquoted, schema-qualified and IF NOT EXISTS names", () =>
    expect(
      createdTables(
        [
          'CREATE TABLE "gift_cards_items" (\n\t"id" uuid PRIMARY KEY NOT NULL\n);',
          "--> statement-breakpoint",
          'CREATE TABLE IF NOT EXISTS "public"."gift_cards_codes" ("id" uuid);',
          "create unlogged table gift_cards_cache (id uuid);",
          'ALTER TABLE "gift_cards_items" ADD COLUMN "x" text;',
        ].join("\n"),
      ),
    ).toEqual(["gift_cards_items", "gift_cards_codes", "gift_cards_cache"]));
  it("returns nothing for SQL that creates no table", () =>
    expect(createdTables('CREATE INDEX "i" ON "gift_cards_items" ("id");')).toEqual([]));
  it("throws instead of passing when a CREATE TABLE name cannot be read", () =>
    expect(() => createdTables("CREATE TABLE (id uuid);")).toThrow("could read only 0"));
});

describe("unprefixedTables", () => {
  const root = mkdtempSync(join(tmpdir(), "contract-helpers-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const folder = (name: string, sqlText: string) => {
    const dir = join(root, name);
    mkdirSync(join(dir, "meta"), { recursive: true });
    writeFileSync(join(dir, "0000_init.sql"), sqlText);
    writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ entries: [{ tag: "0000_init" }] }));
    return dir;
  };

  it("accepts tables prefixed with the id, dashes as underscores", () =>
    expect(unprefixedTables({ id: "gift-cards", migrationsFolder: folder("good", 'CREATE TABLE "gift_cards_items" ();') })).toEqual(
      [],
    ));
  it("flags a table without the prefix", () =>
    expect(
      unprefixedTables({
        id: "gift-cards",
        migrationsFolder: folder("bad", 'CREATE TABLE "gift_cards_items" ();\nCREATE TABLE IF NOT EXISTS "users" ();'),
      }),
    ).toEqual(["users"]));
  it("does not accept the id without its underscore (gift_cardsitems)", () =>
    expect(unprefixedTables({ id: "gift-cards", migrationsFolder: folder("near", "CREATE TABLE gift_cardsitems ();") })).toEqual([
      "gift_cardsitems",
    ]));
});
