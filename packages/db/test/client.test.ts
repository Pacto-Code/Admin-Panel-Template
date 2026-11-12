import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POOL_CONNECTION_TIMEOUT_MS, POOL_IDLE_TIMEOUT_MS, createDb } from "@platform/db";
import { createTestDatabase, TEST_STATEMENT_TIMEOUT_MS } from "@platform/db/testing";

describe("createDb", () => {
  it("sets connection and idle timeouts on the pool", async () => {
    const { pool, close } = createDb("postgres://user:pass@localhost:1/none");
    try {
      expect(pool.options.connectionTimeoutMillis).toBe(POOL_CONNECTION_TIMEOUT_MS);
      expect(pool.options.idleTimeoutMillis).toBe(POOL_IDLE_TIMEOUT_MS);
    } finally {
      await close();
    }
  });

  it("reports idle-client errors to onError instead of crashing", async () => {
    const onError = vi.fn();
    const { pool, close } = createDb("postgres://user:pass@localhost:1/none", { onError });
    try {
      const err = new Error("connection terminated unexpectedly");
      // An 'error' event with no listener would throw here (and crash the process in production).
      expect(() => pool.emit("error", err)).not.toThrow();
      expect(onError).toHaveBeenCalledWith(err);
    } finally {
      await close();
    }
  });

  it("logs idle-client errors to the console when no onError is given", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool, close } = createDb("postgres://user:pass@localhost:1/none");
    try {
      expect(() => pool.emit("error", new Error("boom"))).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      await close();
    }
  });
});

describe("createTestDatabase", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    t = await createTestDatabase([]);
  });
  afterAll(() => t?.drop());

  it("bounds every statement with a timeout", async () => {
    const r = await t.db.execute<{ ms: string }>(
      sql`select (extract(epoch from current_setting('statement_timeout')::interval) * 1000)::int::text as ms`,
    );
    expect(Number(r.rows[0]!.ms)).toBe(TEST_STATEMENT_TIMEOUT_MS);
  });
});
