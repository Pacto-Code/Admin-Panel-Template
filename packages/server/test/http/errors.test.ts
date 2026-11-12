import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTestDatabase } from "@platform/db/testing";
import { FakeTracker, makeApp } from "../fixtures";

let app: INestApplication;
let tracker: FakeTracker;
let drop: () => Promise<void>;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const t = await createTestDatabase([]);
  drop = t.drop;
  ({ app, tracker } = await makeApp(t.db));
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
  await drop();
});

describe("error shape", () => {
  it("wraps AppError in the standard shape", async () => {
    const res = await http.get("/api/v1/test/boom");
    expect(res.status).toBe(418);
    expect(res.body).toEqual({
      error: { code: "x.y", message: "Teapot", fields: {}, requestId: res.headers["x-request-id"] },
    });
  });
  it("maps validation failures to per-field messages", async () => {
    const res = await http.post("/api/v1/test/echo").set("Origin", "http://localhost:3000").send({ email: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("request.validation_failed");
    expect(res.body.error.fields.email).toHaveLength(1);
  });
  it("hides internals on unexpected errors", async () => {
    const res = await http.get("/api/v1/test/crash");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: "server.internal", message: "Something went wrong" });
    expect(JSON.stringify(res.body)).not.toContain("at ");
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
  it("reports unexpected errors to the tracker but not AppErrors", async () => {
    tracker.captured.length = 0;
    await http.get("/api/v1/test/crash");
    await http.get("/api/v1/test/boom");
    expect(tracker.captured).toHaveLength(1);
  });
  it("maps ConflictError to 409", async () => {
    const res = await http.get("/api/v1/test/conflict");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("request.conflict");
  });
  it("rejects a body over 1 MB with 413", async () => {
    const res = await http.post("/api/v1/test/echo").set("Origin", "http://localhost:3000").send({ email: "a@b.co", pad: "x".repeat(1_100_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("request.too_large");
  });
  it("maps unknown routes to 404", async () => {
    const res = await http.get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("request.not_found");
  });
});
