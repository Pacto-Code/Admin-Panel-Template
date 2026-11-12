import "reflect-metadata";
import { Writable } from "node:stream";
import { Controller, Get, Module, Post } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { Db } from "@platform/db";
import { createTestDatabase } from "@platform/db/testing";
import {
  AUTHENTICATOR,
  Authenticated,
  MutationRunner,
  NoAudit,
  PERMISSION_RESOLVER,
  createApp,
} from "../../src";
import { platformMigrations } from "../../db";
import { makeConfig } from "../fixtures";
import { actingAs, FakeAccess } from "../security/fixtures";

@Authenticated()
@Controller()
class AuditTestController {
  constructor(private readonly runner: MutationRunner) {}
  @Post("admin/test/silent")
  silent() {
    return { ok: true };
  }
  @NoAudit("test route that changes nothing")
  @Post("admin/test/exempt")
  exempt() {
    return { ok: true };
  }
  @Post("admin/test/audited")
  async audited() {
    await this.runner.recordOnly({ action: "t.thing.touch", entityType: "t.thing", entityId: null, before: null, after: null });
    return { ok: true };
  }
  @Get("admin/test/read")
  read() {
    return { ok: true };
  }
  @Post("test/outside-admin")
  outside() {
    return { ok: true };
  }
}

@Module({ controllers: [AuditTestController] })
class AuditTestModule {}

async function build(db: Db, auditEnforcement: "throw" | "log", logStream?: Writable) {
  const app = await createApp({
    config: makeConfig({ auditEnforcement, logLevel: "error" }),
    db,
    jobs: "inline",
    modules: [AuditTestModule],
    logStream,
    providers: [
      FakeAccess,
      { provide: AUTHENTICATOR, useExisting: FakeAccess },
      { provide: PERMISSION_RESOLVER, useExisting: FakeAccess },
    ],
  });
  await app.init();
  return app;
}

const A = "/api/v1/admin/test";
const owner = { permissions: [] };
let dev: INestApplication;
let prod: INestApplication;
let as: ReturnType<typeof actingAs>;
let asProd: ReturnType<typeof actingAs>;
let drop: () => Promise<void>;
const logLines: string[] = [];

beforeAll(async () => {
  const t = await createTestDatabase([platformMigrations]);
  drop = t.drop;
  dev = await build(t.db, "throw");
  const sink = new Writable({
    write(chunk, _enc, cb) {
      logLines.push(String(chunk));
      cb();
    },
  });
  prod = await build(t.db, "log", sink);
  as = actingAs(dev);
  asProd = actingAs(prod);
});
afterAll(async () => {
  await dev.close();
  await prod.close();
  await drop();
});

describe("AuditEnforcementInterceptor", () => {
  it("fails a mutating admin route that wrote no audit entry", async () => {
    const res = await as(owner).post(`${A}/silent`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("server.internal");
  });
  it("accepts a mutating route marked @NoAudit", async () =>
    expect((await as(owner).post(`${A}/exempt`)).status).toBe(201));
  it("accepts a mutating route that recorded an entry", async () =>
    expect((await as(owner).post(`${A}/audited`)).status).toBe(201));
  it("ignores GET requests and routes outside /admin", async () => {
    expect((await as(owner).get(`${A}/read`)).status).toBe(200);
    expect((await as(owner).post("/api/v1/test/outside-admin")).status).toBe(201);
  });
  it("logs instead of failing when auditEnforcement is log", async () => {
    expect((await asProd(owner).post(`${A}/silent`)).status).toBe(201);
    expect(logLines.join("")).toContain("wrote no audit entry");
  });
  it("requires a reason for @NoAudit", () => expect(() => NoAudit("  ")).toThrow(/reason/));
});
