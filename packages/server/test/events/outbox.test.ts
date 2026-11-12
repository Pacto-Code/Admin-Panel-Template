import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { uuidv7, type Db, type Tx } from "@platform/db";
import { createApp, EventBus, JobsService, MutationRunner } from "../../src";
import { makeConfig } from "../fixtures";
import { buildDataApp, countRows, createThingDatabase, insertThing, load, rename, ThingListener, ThingModule } from "../data/fixtures";

const handler = ThingListener.calls;

const specFor = (thingId: string) => ({
  action: "t.thing.update",
  entityType: "t.thing",
  mutate: (tx: Tx) => rename(tx, thingId, "new"),
  after: async (tx: Tx) => ({ entityId: thingId, value: await load(tx, thingId) }),
  events: () => [{ name: "t.thing.renamed", payload: { id: thingId } }],
});

// One database for the file: test databases are slow to create.
let db: Db;
let url: string;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, url, drop } = await createThingDatabase());
});
afterAll(() => drop());

describe("outbox (inline jobs)", () => {
  let app: INestApplication;
  let runner: MutationRunner;
  let bus: EventBus;
  let id: string;

  beforeAll(async () => {
    app = await buildDataApp(db);
    runner = app.get(MutationRunner);
    bus = app.get(EventBus);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    handler.mockReset();
    id = uuidv7();
    await insertThing(db, id);
  });

  it("delivers an event to its handler after commit", async () => {
    await runner.run(specFor(id));
    await bus.dispatchPending();
    expect(handler).toHaveBeenCalledWith({ id }, { eventId: expect.any(String) });
  });

  it("does not deliver the same row twice", async () => {
    await runner.run(specFor(id));
    await bus.dispatchPending();
    await bus.dispatchPending();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("delivers each row once under concurrent dispatch", async () => {
    await db.transaction((tx) =>
      bus.publish(
        tx,
        Array.from({ length: 20 }, (_, i) => ({ name: "t.thing.renamed", payload: { i } })),
      ),
    );
    const counts = await Promise.all([bus.dispatchPending(), bus.dispatchPending(), bus.dispatchPending()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(20);
    expect(handler).toHaveBeenCalledTimes(20);
    expect(await countRows(db, "platform_outbox where dispatched_at is null")).toBe(0);
  });

  it("leaves a row pending when its job cannot be enqueued", async () => {
    const jobs = app.get(JobsService);
    const enqueue = vi.spyOn(jobs, "enqueue").mockRejectedValueOnce(new Error("queue down"));
    await db.transaction((tx) => bus.publish(tx, [{ name: "t.thing.renamed", payload: { id } }]));
    await expect(bus.dispatchPending()).rejects.toThrow("queue down");
    expect(await countRows(db, "platform_outbox where dispatched_at is null")).toBe(1);
    enqueue.mockRestore();
    expect(await bus.dispatchPending()).toBe(1);
    expect(handler).toHaveBeenCalledWith({ id }, { eventId: expect.any(String) });
  });

  it("runs a scheduled job on demand", async () => {
    const jobs = app.get(JobsService);
    const fn = vi.fn(async () => {});
    jobs.register("t.cleanup", fn);
    await jobs.schedule("t.cleanup", "0 3 * * *");
    await jobs.runScheduled("t.cleanup");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("outbox (pg-boss)", () => {
  it("starts, delivers an event and stops cleanly", async () => {
    const app = await createApp({ config: makeConfig({ databaseUrl: url }), db, modules: [ThingModule] });
    try {
      await app.init();
      handler.mockReset();
      const id = uuidv7();
      await insertThing(db, id);
      await app.get(MutationRunner).run(specFor(id));
      await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ id }, { eventId: expect.any(String) }), {
        timeout: 15_000,
        interval: 100,
      });
      const schema = await db.execute(sql`select 1 from information_schema.schemata where schema_name = 'pgboss'`);
      expect(schema.rows).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
