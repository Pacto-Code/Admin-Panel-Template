import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** How long to wait for a connection before failing, instead of hanging when the pool is exhausted. */
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;
/** How long an idle client stays in the pool before it is closed. */
export const POOL_IDLE_TIMEOUT_MS = 30_000;

export interface CreateDbOptions {
  /**
   * Receives errors of idle pooled clients (e.g. the server closed the connection). The pool discards the
   * client either way; without a listener the error would crash the process. Defaults to console.error,
   * since this package does not depend on the server's logger.
   */
  onError?: (err: Error) => void;
  /** Server-side `statement_timeout` for every connection, in milliseconds. Unset means the server default. */
  statementTimeoutMs?: number;
}

export function createDb(
  databaseUrl: string,
  opts: CreateDbOptions = {},
): { db: Db; pool: Pool; close(): Promise<void> } {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    ...(opts.statementTimeoutMs !== undefined ? { statement_timeout: opts.statementTimeoutMs } : {}),
  });
  const onError = opts.onError ?? ((err: Error) => console.error("[db] idle client error", err));
  pool.on("error", onError);
  const db = drizzle(pool);
  return { db, pool, close: () => pool.end() };
}
