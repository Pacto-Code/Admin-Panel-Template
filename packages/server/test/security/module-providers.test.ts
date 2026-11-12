import "reflect-metadata";
import { join } from "node:path";
import { Controller, Get, Global, Module } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { Tx } from "@platform/db";
import { createTestDatabase } from "@platform/db/testing";
import {
  AUDIT_RECORDER,
  AUTHENTICATOR,
  Authenticated,
  MutationRunner,
  PERMISSION_RESOLVER,
  RequirePermission,
  createApp,
  requestContext,
  type AuditEntryInput,
  type AuditRecorder,
  type Authenticator,
  type PermissionResolver,
} from "../../src";
import { createTestApp, type TestApp, type TestModule } from "../../src/testing";
import { makeConfig } from "../fixtures";

const ACTOR = { userId: "00000000-0000-7000-8000-0000000000aa", email: "mod@example.com", sessionId: "s-mod" };

/** Stands in for the Phase B auth/access/audit modules: @Global and exporting the platform tokens. */
class ModuleRecorder implements AuditRecorder {
  static readonly entries: AuditEntryInput[] = [];
  async record(_tx: Tx, entry: AuditEntryInput) {
    ModuleRecorder.entries.push(entry);
  }
}
const alwaysSignedIn: Authenticator = { authenticate: async () => ACTOR };
const grantsRead: PermissionResolver = {
  resolve: async () => ({ permissions: ["m.thing.read"], roleKeys: [] }),
  usersWithPermission: async () => [ACTOR.userId],
};

@Controller("admin/m")
class ModController {
  @Authenticated()
  @Get("me")
  me() {
    return requestContext.get()?.actor;
  }
  @RequirePermission("m.thing.read")
  @Get("perm")
  perm() {
    return { ok: true };
  }
}

@Global()
@Module({
  providers: [
    { provide: AUTHENTICATOR, useValue: alwaysSignedIn },
    { provide: PERMISSION_RESOLVER, useValue: grantsRead },
    { provide: AUDIT_RECORDER, useClass: ModuleRecorder },
  ],
  exports: [AUTHENTICATOR, PERMISSION_RESOLVER, AUDIT_RECORDER],
})
class FakePlatformServicesModule {}

@Module({ controllers: [ModController] })
class ModModule {}

describe("tokens provided by a @Global module", () => {
  let app: INestApplication;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const t = await createTestDatabase([]);
    drop = t.drop;
    app = await createApp({ config: makeConfig(), db: t.db, jobs: "inline", modules: [FakePlatformServicesModule, ModModule] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it("uses the module's AUTHENTICATOR in AccessGuard", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/admin/m/me");
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("mod@example.com");
  });

  it("uses the module's PERMISSION_RESOLVER in AccessGuard", async () => {
    expect((await request(app.getHttpServer()).get("/api/v1/admin/m/perm")).status).toBe(200);
  });

  it("sends MutationRunner entries to the module's AUDIT_RECORDER", async () => {
    await app.get(MutationRunner).recordOnly({ action: "m.direct", entityType: "m.thing", entityId: null, before: null, after: null });
    expect(ModuleRecorder.entries.map((e) => e.action)).toContain("m.direct");
  });
});

describe("defaults with no module providing the tokens", () => {
  let app: INestApplication;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const t = await createTestDatabase([]);
    drop = t.drop;
    app = await createApp({ config: makeConfig(), db: t.db, jobs: "inline", modules: [ModModule] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it("nobody is signed in", async () => {
    expect((await request(app.getHttpServer()).get("/api/v1/admin/m/me")).status).toBe(401);
  });

  it("MutationRunner still runs with the no-op recorder", async () => {
    await expect(
      app.get(MutationRunner).recordOnly({ action: "x", entityType: "x", entityId: null, before: null, after: null }),
    ).resolves.toBeUndefined();
  });
});

describe("createTestApp with modules that provide the tokens", () => {
  const emptyMigrations = join(import.meta.dirname, "../testing/fixtures/empty-migrations");
  const services = (id: string): TestModule => ({
    id,
    manifest: { id, name: id, permissions: [] },
    apiModule: FakePlatformServicesModule,
    migrationsFolder: emptyMigrations,
  });
  const mod: TestModule = {
    id: "m",
    manifest: { id: "m", name: "M", permissions: [{ key: "m.thing.read", label: "Read" }] },
    apiModule: ModModule,
    migrationsFolder: emptyMigrations,
  };
  let t: TestApp;
  beforeAll(async () => {
    // Named "audit" so the harness knows the recorder is real; realAuth leaves authentication to the module.
    t = await createTestApp({ modules: [services("audit"), mod], realAuth: true });
  });
  afterAll(() => t?.close());

  it("realAuth uses the module's authenticator", async () => {
    const res = await t.anon().get("/api/v1/admin/m/me");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(ACTOR.userId);
  });

  it("routes audit entries to the loaded audit module, not the fake", async () => {
    const before = ModuleRecorder.entries.length;
    await t.app.get(MutationRunner).recordOnly({ action: "m.harness", entityType: "m.thing", entityId: null, before: null, after: null });
    expect(ModuleRecorder.entries.slice(before).map((e) => e.action)).toEqual(["m.harness"]);
    expect(() => t.recorder).toThrow(/audit/);
  });

  it("throws on as() under realAuth", () => {
    expect(() => t.as("owner")).toThrow(/realAuth/);
  });
});
