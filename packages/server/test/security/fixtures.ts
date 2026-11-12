import "reflect-metadata";
import { Controller, Get, Injectable, Module, Post } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import type { Request } from "express";
import request from "supertest";
import type { Db } from "@platform/db";
import {
  AUTHENTICATOR,
  Authenticated,
  CsrfService,
  DemoLocked,
  PERMISSION_RESOLVER,
  Public,
  RequirePermission,
  createApp,
  requestContext,
  type Actor,
  type Authenticator,
  type PermissionResolver,
} from "../../src";
import { makeConfig } from "../fixtures";

export interface TestUser {
  userId?: string;
  permissions: string[];
}

/** Reads `x-test-user` (JSON) as the session. Doubles as the permission resolver. */
@Injectable()
export class FakeAccess implements Authenticator, PermissionResolver {
  private readonly users = new Map<string, string[]>();
  async authenticate(req: Request): Promise<Actor | null> {
    const raw = req.header("x-test-user");
    if (!raw) return null;
    const u = JSON.parse(raw) as TestUser;
    const userId = u.userId ?? "u-default";
    this.users.set(userId, u.permissions);
    return { userId, email: `${userId}@example.com`, sessionId: `s-${userId}` };
  }
  async resolve(userId: string) {
    return { permissions: this.users.get(userId) ?? [], roleKeys: [] };
  }
  async usersWithPermission(key: string) {
    return [...this.users].filter(([, p]) => p.includes(key)).map(([id]) => id);
  }
}

@Controller("test")
export class SecurityController {
  @Public()
  @Get("pub")
  pubGet() {
    return { ok: true };
  }
  @Public()
  @Post("pub")
  pubPost() {
    return { ok: true };
  }
  @Authenticated()
  @Get("authed")
  authed() {
    return { ok: true };
  }
  @RequirePermission("t.thing.read")
  @Get("perm")
  perm() {
    return { ok: true };
  }
  @RequirePermission("t.thing.update")
  @Post("perm")
  permPost() {
    return { ok: true };
  }
  @Authenticated()
  @DemoLocked()
  @Post("locked")
  locked() {
    return { ok: true };
  }
  @Authenticated()
  @Get("whoami")
  whoami() {
    return { userId: requestContext.get()?.actor?.userId };
  }
  @Get("bare")
  bare() {
    return { ok: true };
  }
}

@Module({ controllers: [SecurityController] })
export class SecurityModule {}

export async function buildApp(db: Db, profile: "demo" | "dev") {
  const config = makeConfig(
    profile === "demo" ? { demo: { oneClickLogin: true, lockRiskySettings: true, resetCron: null } } : {},
  );
  const app = await createApp({
    config,
    db,
    modules: [SecurityModule],
    providers: [
      FakeAccess,
      { provide: AUTHENTICATOR, useExisting: FakeAccess },
      { provide: PERMISSION_RESOLVER, useExisting: FakeAccess },
    ],
  });
  await app.init();
  return app;
}

/** Supertest helper acting as a signed-in user; a CSRF token is added to non-GET calls unless disabled. */
export function actingAs(app: INestApplication) {
  const http = request(app.getHttpServer());
  const csrf = app.get(CsrfService);
  return (user: TestUser, opts: { csrf?: boolean } = {}) => {
    const userId = user.userId ?? "u-default";
    const json = JSON.stringify(user);
    return {
      get: (url: string) => http.get(url).set("x-test-user", json),
      post: (url: string) => {
        const r = http.post(url).set("x-test-user", json);
        return opts.csrf === false ? r : r.set("x-csrf-token", csrf.tokenFor(`s-${userId}`));
      },
    };
  };
}
