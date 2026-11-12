import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createDb } from "@platform/db";
import { createTestDatabase } from "@platform/db/testing";
import { createApp, requestContext } from "../../src";
import { FakeTracker, makeApp, makeConfig, TestModule } from "../fixtures";

let app: INestApplication;
let drop: () => Promise<void>;
let http: ReturnType<typeof request>;
let dbUrl: string;

beforeAll(async () => {
  const t = await createTestDatabase([]);
  drop = t.drop;
  dbUrl = t.url;
  ({ app } = await makeApp(t.db));
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
  await drop();
});

describe("hardening", () => {
  it("sets security headers", async () => {
    const res = await http.get("/api/v1/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
  it("limits CORS to the admin origin", async () => {
    const ok = await http.get("/api/v1/health").set("Origin", "http://localhost:3000");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const bad = await http.get("/api/v1/health").set("Origin", "http://evil.example");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("echoes an incoming request id and generates one otherwise", async () => {
    const a = await http.get("/api/v1/health").set("X-Request-Id", "abc-123");
    expect(a.headers["x-request-id"]).toBe("abc-123");
    const b = await http.get("/api/v1/health");
    expect(b.headers["x-request-id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });
  it("scopes the request context with run", () => {
    expect(requestContext.get()).toBeUndefined();
    const ctx = { requestId: "r", actor: null, ip: null, userAgent: null, auditCount: 0 };
    expect(requestContext.run(ctx, () => requestContext.get()?.requestId)).toBe("r");
  });
  it("reports ready when the database answers", async () => {
    const res = await http.get("/api/v1/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
  });
  it("reports 503 when the database is unreachable", async () => {
    const { db, close } = createDb(dbUrl);
    await close();
    const closed = await createApp({
      config: makeConfig(),
      db,
      modules: [TestModule],
      errorTracker: new FakeTracker(),
    });
    await closed.init();
    const res = await request(closed.getHttpServer()).get("/api/v1/ready");
    expect(res.status).toBe(503);
    await closed.close();
  });
  it("rate limits at 300 requests per minute per IP", async () => {
    const t = await createTestDatabase([]);
    const { app: limited } = await makeApp(t.db);
    const h = request(limited.getHttpServer());
    let status = 200;
    let code: unknown;
    for (let i = 0; i < 301; i++) {
      const r = await h.get("/api/v1/health");
      status = r.status;
      code = r.body?.error?.code;
    }
    expect(status).toBe(429);
    expect(code).toBe("request.rate_limited");
    await limited.close();
    await t.drop();
  });
  it("logs the request id and redacts secrets", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const t = await createTestDatabase([]);
    const logged = await createApp({
      config: makeConfig({ logLevel: "info" }),
      db: t.db,
      modules: [TestModule],
      errorTracker: new FakeTracker(),
      logStream: sink,
    });
    await logged.init();
    await request(logged.getHttpServer())
      .post("/api/v1/test/echo")
      .set("Origin", "http://localhost:3000")
      .set("Authorization", "Bearer topsecret")
      .set("Cookie", "sid=topsecret")
      .set("X-Request-Id", "rid-1")
      .send({ email: "a@b.co", password: "hunter2" });
    await logged.close();
    await t.drop();
    const out = lines.join("");
    expect(out).toContain("rid-1");
    expect(out).not.toContain("topsecret");
    expect(out).not.toContain("hunter2");
  });
});
