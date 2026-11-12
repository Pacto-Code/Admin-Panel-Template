import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(databaseUrl: string): { db: Db; close(): Promise<void> } {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  return { db, close: () => pool.end() };
}
