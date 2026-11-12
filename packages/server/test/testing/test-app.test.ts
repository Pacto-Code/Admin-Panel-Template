import "reflect-metadata";
import { join } from "node:path";
import { Controller, Get, Inject, Injectable, Module, Post } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventBus,
  MAILER,
  MutationRunner,
  NoAudit,
  OnEvent,
  Public,
  RequirePermission,
  requestContext,
  type Mailer,
} from "../../src";
import { createTestApp, type TestApp, type TestModule } from "../../src/testing";

@Injectable()
class PingListener {
  static readonly received: unknown[] = [];
  @OnEvent("t.ping")
  onPing(payload: unknown) {
    PingListener.received.push(payload);
  }
}

@Controller("admin/t")
class ThingsController {
  constructor(
    private readonly runner: MutationRunner,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  @RequirePermission("t.thing.read")
  @Get("me")
  me() {
    return requestContext.get()?.actor;
  }

  @RequirePermission("t.thing.update")
  @Post("touch")
  async touch() {
    await this.runner.recordOnly({ action: "t.thing.touch", entityType: "t.thing", entityId: null, before: null, after: null });
    await this.mailer.send({ to: "a@example.com", subject: "Touched", html: "<p>Touched</p>", text: "Touched" });
    return { ok: true };
  }

  @Public()
  @NoAudit("Fixture route that changes nothing")
  @Post("ping")
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [ThingsController], providers: [PingListener] })
class ThingsModule {}

const thingsModule: TestModule = {
  id: "t",
  manifest: {
    id: "t",
    name: "Things",
    permissions: [
      { key: "t.thing.read", label: "Read" },
      { key: "t.thing.update", label: "Update" },
    ],
  },
  apiModule: ThingsModule,
  migrationsFolder: join(import.meta.dirname, "fixtures/empty-migrations"),
};

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ modules: [thingsModule], store: { branding: { name: "Fixture", primaryColor: "#000000" } } });
});
afterAll(() => t?.close());

describe("createTestApp", () => {
  it("builds the config from a test env and the given store", () => {
    expect(t.config.env).toBe("development");
    expect(t.config.branding.name).toBe("Fixture");
    expect(t.config.modules).toEqual({ t: {} });
  });

  it("gives the owner every permission the loaded modules declare", async () => {
    const res = await t.as("owner").post("/api/v1/admin/t/touch");
    expect(res.status).toBe(201);
    expect((await t.as("owner").get("/api/v1/admin/t/me")).body.email).toBe("owner@example.com");
  });

  it("acts as an actor holding only the given permissions", async () => {
    const reader = { email: "reader@example.com", permissions: ["t.thing.read"] };
    expect((await t.as(reader).get("/api/v1/admin/t/me")).body.email).toBe("reader@example.com");
    expect((await t.as(reader).post("/api/v1/admin/t/touch")).status).toBe(403);
  });

  it("gives actors with different permissions different user ids", async () => {
    const a = (await t.as({ permissions: ["t.thing.read"] }).get("/api/v1/admin/t/me")).body.userId;
    const b = (await t.as({ permissions: ["t.thing.read", "t.thing.update"] }).get("/api/v1/admin/t/me")).body.userId;
    expect(a).not.toBe(b);
  });

  it("sends a CSRF token unless told not to", async () => {
    const res = await t.as("owner", { csrf: false }).post("/api/v1/admin/t/touch");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("auth.csrf_invalid");
  });

  it("acts anonymously from the admin origin", async () => {
    expect((await t.anon().get("/api/v1/admin/t/me")).status).toBe(401);
    expect((await t.anon().post("/api/v1/admin/t/ping")).status).toBe(201);
  });

  it("captures audit entries and mail", async () => {
    const entries = t.recorder.entries.length;
    const sent = t.mail.sent.length;
    await t.as("owner").post("/api/v1/admin/t/touch");
    expect(t.recorder.entries.slice(entries)).toMatchObject([{ action: "t.thing.touch" }]);
    expect(t.mail.sent.slice(sent)).toMatchObject([{ to: "a@example.com", subject: "Touched" }]);
  });

  it("delivers pending outbox events on flushEvents", async () => {
    await t.db.transaction((tx) => t.app.get(EventBus).publish(tx, [{ name: "t.ping", payload: { n: 1 } }]));
    expect(PingListener.received).toEqual([]);
    await t.flushEvents();
    expect(PingListener.received).toEqual([{ n: 1 }]);
  });
});
