import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { POOL_CONNECTION_TIMEOUT_MS, createDb, type Db } from "./client";
import { runMigrations, type MigrationSource } from "./migrate";

const DEFAULT_URL = "postgres://postgres:postgres@localhost:5432/postgres";
/** Test connections abort any statement running longer than this, so a stuck query fails instead of hanging. */
export const TEST_STATEMENT_TIMEOUT_MS = 60_000;

/** Creates a uniquely named database, migrates it, and returns a handle that can drop it. */
export async function createTestDatabase(
  sources: MigrationSource[],
): Promise<{ db: Db; url: string; drop(): Promise<void> }> {
  const adminUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
  const name = `test_${randomBytes(8).toString("hex")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;

  const withAdmin = async <T>(fn: (pool: Pool) => Promise<T>): Promise<T> => {
    const admin = new Pool({
      connectionString: adminUrl,
      max: 1,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
      statement_timeout: TEST_STATEMENT_TIMEOUT_MS,
    });
    admin.on("error", (err) => console.error("[db] test admin client error", err));
    try {
      return await fn(admin);
    } finally {
      await admin.end();
    }
  };

  await withAdmin((admin) => admin.query(`create database "${name}"`));
  const { db, close } = createDb(url.toString(), { statementTimeoutMs: TEST_STATEMENT_TIMEOUT_MS });
  try {
    await runMigrations(db, sources);
  } catch (err) {
    await close();
    await withAdmin((admin) => admin.query(`drop database if exists "${name}" with (force)`));
    throw err;
  }
  return {
    db,
    url: url.toString(),
    async drop() {
      await close();
      await withAdmin((admin) => admin.query(`drop database if exists "${name}" with (force)`));
    },
  };
}
