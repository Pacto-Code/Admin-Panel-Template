import "reflect-metadata";
import { Writable } from "node:stream";
import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@platform/db";
import { createTestDatabase } from "@platform/db/testing";
import { createApp } from "../../src";
import { FakeTracker, makeConfig, TestModule } from "../fixtures";

const MISSING = Symbol("MISSING");

@Injectable()
class NeedsMissing {
  constructor(@Inject(MISSING) readonly missing: unknown) {}
}

@Module({ providers: [NeedsMissing] })
class BrokenModule {}

function sink() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, stream };
}

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  const t = await createTestDatabase([]);
  db = t.db;
  drop = t.drop;
});
afterAll(() => drop?.());

describe("Nest logging", () => {
  it("rejects with the DI error instead of exiting the process", async () => {
    const { stream } = sink();
    await expect(
      createApp({
        config: makeConfig(),
        db,
        jobs: "inline",
        modules: [BrokenModule],
        errorTracker: new FakeTracker(),
        logStream: stream,
      }),
    ).rejects.toThrow(/NeedsMissing/);
  });

  it("sends Nest Logger output to the pino stream", async () => {
    const { lines, stream } = sink();
    const app = await createApp({
      config: makeConfig({ logLevel: "info" }),
      db,
      jobs: "inline",
      modules: [TestModule],
      errorTracker: new FakeTracker(),
      logStream: stream,
    });
    try {
      new Logger("Jobs").error(new Error("queue exploded"));
      new Logger("Events").warn("outbox slow");
      const records = lines.map((l) => JSON.parse(l) as { level: number; msg: string; context?: string; err?: { message: string } });
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ level: 50, context: "Jobs", err: expect.objectContaining({ message: "queue exploded" }) }),
          expect.objectContaining({ level: 40, context: "Events", msg: "outbox slow" }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it("respects the configured level", async () => {
    const { lines, stream } = sink();
    const app = await createApp({
      config: makeConfig({ logLevel: "silent" }),
      db,
      jobs: "inline",
      modules: [TestModule],
      errorTracker: new FakeTracker(),
      logStream: stream,
    });
    try {
      new Logger("Jobs").error("hidden");
      expect(lines).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
