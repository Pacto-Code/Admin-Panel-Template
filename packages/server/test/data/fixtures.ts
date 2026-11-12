import "reflect-metadata";
import { Injectable, Module, type INestApplication, type Provider, type Type } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { vi } from "vitest";
import type { Db, Tx } from "@platform/db";
import { createTestDatabase } from "@platform/db/testing";
import { platformMigrations } from "../../db";
import { AUDIT_RECORDER, OnEvent, createApp, type AuditRecorder } from "../../src";
import { makeConfig } from "../fixtures";

export { FakeRecorder } from "../../src/testing";

/** Receives `t.thing.renamed`; `calls` is shared so tests can assert deliveries. */
@Injectable()
export class ThingListener {
  static readonly calls = vi.fn();
  @OnEvent("t.thing.renamed")
  async onRenamed(payload: unknown, meta: { eventId: string }) {
    ThingListener.calls(payload, meta);
  }
}

@Module({ providers: [ThingListener] })
export class ThingModule {}

/** A fresh database with the platform migrations plus the `t_things` fixture table (not part of the platform schema). */
export async function createThingDatabase() {
  const t = await createTestDatabase([platformMigrations]);
  await t.db.execute(sql`create table t_things (id uuid primary key, name text not null, secret text)`);
  return t;
}

export async function insertThing(db: Db, id: string, name = "old") {
  await db.execute(sql`insert into t_things (id, name, secret) values (${id}, ${name}, 's3cr3t')`);
}

export async function load(db: Db | Tx, id: string): Promise<{ id: string; name: string; secret: string }> {
  const r = await db.execute<{ id: string; name: string; secret: string }>(
    sql`select id, name, secret from t_things where id = ${id}`,
  );
  return r.rows[0]!;
}

export async function rename(tx: Tx, id: string, name: string) {
  await tx.execute(sql`update t_things set name = ${name} where id = ${id}`);
}

export async function countRows(db: Db, table: string): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(table)}`);
  return r.rows[0]!.n;
}

export async function buildDataApp(
  db: Db,
  opts: { modules?: Type[]; providers?: Provider[]; recorder?: AuditRecorder; config?: ReturnType<typeof makeConfig> } = {},
): Promise<INestApplication> {
  const app = await createApp({
    config: opts.config ?? makeConfig(),
    db,
    jobs: "inline",
    modules: opts.modules ?? [ThingModule],
    providers: [...(opts.recorder ? [{ provide: AUDIT_RECORDER, useValue: opts.recorder }] : []), ...(opts.providers ?? [])],
  });
  await app.init();
  return app;
}
