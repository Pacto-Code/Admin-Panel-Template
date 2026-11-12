import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTestDatabase } from "@platform/db/testing";
import { actingAs, buildApp } from "./fixtures";

const T = "/api/v1/test";
const ORIGIN = "http://localhost:3000";
let app: INestApplication;
let demoApp: INestApplication;
let http: ReturnType<typeof request>;
let as: ReturnType<typeof actingAs>;
let asDemo: ReturnType<typeof actingAs>;
const drops: Array<() => Promise<void>> = [];

beforeAll(async () => {
  const a = await createTestDatabase([]);
  const b = await createTestDatabase([]);
  drops.push(a.drop, b.drop);
  app = await buildApp(a.db, "dev");
  demoApp = await buildApp(b.db, "demo");
  http = request(app.getHttpServer());
  as = actingAs(app);
  asDemo = actingAs(demoApp);
});
afterAll(async () => {
  await app.close();
  await demoApp.close();
  for (const d of drops) await d();
});

describe("AccessGuard", () => {
  it("allows a public GET without a session", async () => expect((await http.get(`${T}/pub`)).status).toBe(200));
  it("allows a public POST from the admin origin", async () =>
    expect((await http.post(`${T}/pub`).set("Origin", ORIGIN)).status).toBe(201));
  it("rejects a public POST from another origin", async () =>
    expect((await http.post(`${T}/pub`).set("Origin", "https://evil.example")).body.error.code).toBe(
      "auth.csrf_invalid",
    ));
  it("rejects a public POST with no Origin", async () => {
    const res = await http.post(`${T}/pub`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("auth.csrf_invalid");
  });
  it("returns 401 without a session", async () => {
    const res = await http.get(`${T}/authed`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("auth.unauthenticated");
  });
  it("allows an authenticated user", async () =>
    expect((await as({ permissions: [] }).get(`${T}/authed`)).status).toBe(200));
  it("returns 403 without the permission", async () => {
    const res = await as({ permissions: [] }).get(`${T}/perm`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("auth.forbidden");
  });
  it("allows with the permission", async () =>
    expect((await as({ permissions: ["t.thing.read"] }).get(`${T}/perm`)).status).toBe(200));
  it("rejects an authenticated POST without a CSRF token", async () =>
    expect((await as({ permissions: ["t.thing.update"] }, { csrf: false }).post(`${T}/perm`)).body.error.code).toBe(
      "auth.csrf_invalid",
    ));
  it("accepts an authenticated POST with a CSRF token", async () =>
    expect((await as({ permissions: ["t.thing.update"] }).post(`${T}/perm`)).status).toBe(201));
  it("denies an undecorated route", async () =>
    expect((await as({ permissions: ["*"] }).get(`${T}/bare`)).status).toBe(403));
  it("blocks @DemoLocked routes in the demo profile only", async () => {
    const owner = { permissions: [] };
    expect((await asDemo(owner).post(`${T}/locked`)).body.error.code).toBe("demo.locked");
    expect((await as(owner).post(`${T}/locked`)).status).toBe(201);
  });
  it("puts the actor in the request context", async () =>
    expect((await as({ userId: "u1", permissions: [] }).get(`${T}/whoami`)).body.userId).toBe("u1"));
  it("keeps health public", async () => expect((await http.get("/api/v1/health")).status).toBe(200));
});
