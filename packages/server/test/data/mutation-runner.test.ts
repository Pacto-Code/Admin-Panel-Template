import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { uuidv7, type Db, type Tx } from "@platform/db";
import { MutationRunner, requestContext, type RequestContext } from "../../src";
import { buildDataApp, countRows, createThingDatabase, FakeRecorder, insertThing, load, rename } from "./fixtures";

let db: Db;
let drop: () => Promise<void>;
let app: INestApplication;
let runner: MutationRunner;
const recorder = new FakeRecorder();
let id: string;

const specFor = (thingId: string) => ({
  action: "t.thing.update",
  entityType: "t.thing",
  before: () => load(db, thingId),
  mutate: (tx: Tx) => rename(tx, thingId, "new"),
  after: async (tx: Tx) => ({ entityId: thingId, value: await load(tx, thingId) }),
  events: () => [{ name: "t.thing.renamed", payload: { id: thingId } }],
});

beforeAll(async () => {
  ({ db, drop } = await createThingDatabase());
  app = await buildDataApp(db, { recorder });
  runner = app.get(MutationRunner);
});
afterAll(async () => {
  await app.close();
  await drop();
});
beforeEach(async () => {
  recorder.entries = [];
  id = uuidv7();
  await insertThing(db, id);
});

const ctx = (): RequestContext => ({ requestId: "r1", actor: null, ip: null, userAgent: null, auditCount: 0 });

describe("MutationRunner", () => {
  it("records before and after in the same transaction", async () => {
    await runner.run({
      action: "t.thing.update",
      entityType: "t.thing",
      before: () => load(db, id),
      mutate: (tx) => rename(tx, id, "new"),
      after: async (tx) => ({ entityId: id, value: await load(tx, id) }),
    });
    expect(recorder.entries[0]).toMatchObject({
      action: "t.thing.update",
      entityId: id,
      before: { name: "old" },
      after: { name: "new" },
    });
  });

  it("rolls back the change, the audit entry and the events together", async () => {
    const outboxBefore = await countRows(db, "platform_outbox");
    await expect(
      runner.run({
        ...specFor(id),
        mutate: async (tx) => {
          await rename(tx, id, "x");
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect((await load(db, id)).name).toBe("old");
    expect(recorder.entries).toHaveLength(0);
    expect(await countRows(db, "platform_outbox")).toBe(outboxBefore);
  });

  it("redacts default and spec-level sensitive keys in before and after", async () => {
    await runner.run({ ...specFor(id), sensitive: ["name"] });
    expect(recorder.entries[0]).toMatchObject({
      before: { secret: "[redacted]", name: "[redacted]" },
      after: { secret: "[redacted]", name: "[redacted]" },
    });
  });

  it("returns the mutate result and records a null before when none is given", async () => {
    const result = await runner.run({
      action: "t.thing.create",
      entityType: "t.thing",
      mutate: async () => 42,
      after: async (_tx, r) => ({ entityId: null, value: { r } }),
    });
    expect(result).toBe(42);
    expect(recorder.entries[0]).toMatchObject({ before: null, after: { r: 42 } });
  });

  it("counts audit entries in the request context for run and recordOnly", async () => {
    const c = ctx();
    await requestContext.run(c, async () => {
      await runner.run(specFor(id));
      await runner.recordOnly({ action: "auth.sign_in", entityType: "auth.user", entityId: null, before: null, after: { token: "t" } });
    });
    expect(c.auditCount).toBe(2);
    expect(recorder.entries[1]).toMatchObject({ action: "auth.sign_in", after: { token: "[redacted]" } });
  });
});
