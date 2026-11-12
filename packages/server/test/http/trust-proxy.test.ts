import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTestDatabase } from "@platform/db/testing";
import { FakeTracker, makeApp, makeConfig } from "../fixtures";

const CLIENT = "203.0.113.7";
const apps: INestApplication[] = [];
let drop: () => Promise<void>;
let direct: INestApplication;
let behindProxy: INestApplication;

beforeAll(async () => {
  const t = await createTestDatabase([]);
  drop = t.drop;
  ({ app: direct } = await makeApp(t.db));
  ({ app: behindProxy } = await makeApp(t.db, new FakeTracker(), makeConfig({ trustProxy: 1 })));
  apps.push(direct, behindProxy);
});
afterAll(async () => {
  for (const app of apps) await app.close();
  await drop?.();
});

/** The client address the platform sees: RequestContext.ip is req.ip, which is also the throttler's key. */
const ipSeenBy = async (app: INestApplication) =>
  (await request(app.getHttpServer()).get("/api/v1/test/ip").set("X-Forwarded-For", CLIENT)).body.ip as string;

describe("trust proxy", () => {
  it("ignores X-Forwarded-For by default", async () => {
    expect(await ipSeenBy(direct)).not.toBe(CLIENT);
  });
  it("uses the forwarded client address when trustProxy is a hop count", async () => {
    expect(await ipSeenBy(behindProxy)).toBe(CLIENT);
  });
});
