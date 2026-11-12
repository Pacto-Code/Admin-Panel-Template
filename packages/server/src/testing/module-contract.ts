import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DynamicModule, ForwardReference, Type } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateManifest } from "@platform/core";
import { ACCESS_KEY, PERMISSION_KEY } from "../security/decorators";
import { controllerRoutes, findUnguardedRoutes } from "../security/route-audit";
import { createTestApp, type TestApp, type TestModule } from "./test-app";

export interface ModuleRoute {
  method: string;
  path: string;
  /** The @RequirePermission key, if the route has one. */
  permission: string | undefined;
  /** Whether the route (or its controller) declares @Public, @Authenticated or @RequirePermission. */
  guarded: boolean;
}

type ModuleImport = Type | DynamicModule | ForwardReference | Promise<DynamicModule>;

/** Routes declared by `root` and the modules it imports, stopping at `exclude` (the modules it depends on). */
export function moduleRoutes(root: Type, exclude: Type[] = []): ModuleRoute[] {
  const seen = new Set<unknown>(exclude);
  const controllers: Type[] = [];
  const visit = (entry: ModuleImport | undefined): void => {
    if (!entry || entry instanceof Promise) return;
    if ("forwardRef" in entry) return visit(entry.forwardRef() as ModuleImport);
    const dynamic = "module" in entry ? entry : undefined;
    const type = dynamic ? dynamic.module : (entry as Type);
    if (seen.has(type)) return;
    seen.add(type);
    const meta = (key: string) => (Reflect.getMetadata(key, type) as unknown[] | undefined) ?? [];
    controllers.push(...(meta(MODULE_METADATA.CONTROLLERS) as Type[]), ...(dynamic?.controllers ?? []));
    for (const imported of [...meta(MODULE_METADATA.IMPORTS), ...(dynamic?.imports ?? [])]) visit(imported as ModuleImport);
  };
  visit(root);
  return controllers.flatMap((c) =>
    controllerRoutes(c).map(({ method, path, handler }) => ({
      method,
      path,
      permission: Reflect.getMetadata(PERMISSION_KEY, handler) as string | undefined,
      guarded: Reflect.getMetadata(ACCESS_KEY, handler) !== undefined || Reflect.getMetadata(ACCESS_KEY, c) !== undefined,
    })),
  );
}

const routesOf = (module: TestModule, dependencies: TestModule[]) =>
  moduleRoutes(
    module.apiModule,
    dependencies.map((d) => d.apiModule),
  );

/** The module's own routes with no access decorator, as "METHOD /path". */
export function unguardedRoutes(module: TestModule, dependencies: TestModule[] = []): string[] {
  return routesOf(module, dependencies)
    .filter((r) => !r.guarded)
    .map((r) => `${r.method} ${r.path}`);
}

/** The module's routes whose @RequirePermission key its manifest does not declare. */
export function undeclaredPermissions(module: TestModule, dependencies: TestModule[] = []): string[] {
  const declared = new Set(module.manifest.permissions.map((p) => p.key));
  return routesOf(module, dependencies)
    .filter((r) => r.permission !== undefined && !declared.has(r.permission))
    .map((r) => `${r.method} ${r.path} requires "${r.permission}"`);
}

/** The migrations drizzle-kit generated into a folder, oldest first. */
const migrationTags = (folder: string): string[] =>
  (JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] }).entries.map(
    (e) => e.tag,
  );

const CREATE_TABLE = /\bcreate\s+(?:\w+\s+)*?table\b/gi;
const CREATE_TABLE_NAME =
  /\bcreate\s+(?:\w+\s+)*?table\s+(?:if\s+not\s+exists\s+)?(?:(?:"[^"]+"|\w+)\.)?(?:"([^"]+)"|(\w+))/gi;

/** Table names a migration's SQL creates. Throws when a CREATE TABLE's name cannot be read, so the check never passes vacuously. */
export function createdTables(sqlText: string): string[] {
  const names = [...sqlText.matchAll(CREATE_TABLE_NAME)].map((m) => (m[1] ?? m[2])!);
  const statements = sqlText.match(CREATE_TABLE)?.length ?? 0;
  if (names.length !== statements) {
    throw new Error(`Found ${statements} CREATE TABLE statement(s) but could read only ${names.length} table name(s)`);
  }
  return names;
}

/** Tables the module's migrations create without its `<id>_` prefix (dashes as underscores). */
export function unprefixedTables(module: Pick<TestModule, "id" | "migrationsFolder">): string[] {
  const prefix = `${module.id.replaceAll("-", "_")}_`;
  return migrationTags(module.migrationsFolder)
    .flatMap((tag) => createdTables(readFileSync(join(module.migrationsFolder, `${tag}.sql`), "utf8")))
    .filter((name) => !name.startsWith(prefix));
}

const SAMPLE_ID = "00000000-0000-7000-8000-000000000000";

/**
 * Registers the checks every module must pass: a valid manifest, guarded routes with declared permissions,
 * migrations that apply cleanly and only create `<id>_` tables, and booting with (and, unless core, without) it.
 */
export function describeModuleContract(opts: { module: TestModule; dependencies: TestModule[] }): void {
  const { module, dependencies } = opts;
  const prefix = `${module.id.replaceAll("-", "_")}_`;

  describe(`module contract: ${module.id}`, () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ modules: [...dependencies, module] });
    });
    afterAll(() => t?.close());

    it("has a valid manifest", () => {
      expect(module.manifest.id).toBe(module.id);
      expect(validateManifest(module.manifest)).toEqual([]);
    });

    it("declares an access decorator on every route", () => {
      expect(unguardedRoutes(module, dependencies)).toEqual([]);
      // The booted app also covers controllers the static walk cannot see (e.g. async dynamic modules).
      expect(findUnguardedRoutes(t.app)).toEqual([]);
    });

    it("declares every @RequirePermission key in its manifest", () =>
      expect(undeclaredPermissions(module, dependencies)).toEqual([]));

    it("applies its migrations on a clean database", async () => {
      const table = `__migrations_${module.id.replaceAll("-", "_")}`;
      const applied = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.${sql.identifier(table)}`);
      expect(applied.rows[0]!.n).toBe(migrationTags(module.migrationsFolder).length);
    });

    it(`prefixes every table with "${prefix}"`, () => expect(unprefixedTables(module)).toEqual([]));

    it("boots with the module", async () => expect((await t.anon().get("/api/v1/health")).status).toBe(200));

    if (!module.manifest.core) {
      it("boots without it, and its routes return 404", async () => {
        const off = await createTestApp({ modules: dependencies });
        try {
          const owner = off.as("owner");
          for (const route of routesOf(module, dependencies)) {
            const method = route.method === "ALL" ? "get" : (route.method.toLowerCase() as "get");
            const res = await owner[method](route.path.replace(/:\w+/g, SAMPLE_ID));
            expect(res.status, `${route.method} ${route.path}`).toBe(404);
          }
        } finally {
          await off.close();
        }
      });
    }
  });
}
