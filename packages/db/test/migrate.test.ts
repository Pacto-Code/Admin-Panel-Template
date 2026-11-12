import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ConflictError,
  expectUpdated,
  runMigrations,
  type Db,
  type MigrationSource,
} from "@platform/db";
import { createTestDatabase } from "@platform/db/testing";

const alpha: MigrationSource = {
  id: "alpha",
  migrationsFolder: join(import.meta.dirname, "fixtures/alpha/db/migrations"),
};
const beta: MigrationSource = {
  id: "beta",
  migrationsFolder: join(import.meta.dirname, "fixtures/beta/db/migrations"),
};

async function listTables(db: Db): Promise<string[]> {
  const r = await db.execute<{ t: string }>(
    sql`select table_schema || '.' || table_name as t from information_schema.tables`,
  );
  return r.rows.map((row) => row.t);
}

async function countRows(db: Db, table: string): Promise<number> {
  const r = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)}`,
  );
  return r.rows[0]!.n;
}

// These tests create their database in the test body, which can queue behind other files' CREATE DATABASE.
const DB_TEST_TIMEOUT = 120_000;

describe("runMigrations", () => {
  it("applies each module's migrations with its own tracking table", async () => {
    const t = await createTestDatabase([alpha, beta]);
    const tables = await listTables(t.db);
    expect(tables).toEqual(
      expect.arrayContaining([
        "public.alpha_items",
        "public.beta_notes",
        "drizzle.__migrations_alpha",
        "drizzle.__migrations_beta",
      ]),
    );
    await t.drop();
  }, DB_TEST_TIMEOUT);

  it("is safe to run twice", async () => {
    const t = await createTestDatabase([alpha]);
    await runMigrations(t.db, [alpha]);
    expect(await countRows(t.db, "drizzle.__migrations_alpha")).toBe(1);
    await t.drop();
  }, DB_TEST_TIMEOUT);

  it("adds a module later without touching earlier ones", async () => {
    const t = await createTestDatabase([alpha]);
    await runMigrations(t.db, [alpha, beta]);
    expect(await listTables(t.db)).toContain("public.beta_notes");
    await t.drop();
  }, DB_TEST_TIMEOUT);
});

describe("helpers", () => {
  it("expectUpdated throws ConflictError on an empty result", () =>
    expect(() => expectUpdated([])).toThrow(ConflictError));

  it("expectUpdated returns the first row", () => expect(expectUpdated([1, 2])).toBe(1));
});
