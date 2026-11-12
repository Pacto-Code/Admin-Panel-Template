import "reflect-metadata";
import { Controller, Get, Module, Post } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
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
} from "../../src";
import { FakeAccess, TEST_ACTOR_HEADER, type TestActor } from "../../src/testing";
import { makeConfig } from "../fixtures";

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
    jobs: "inline",
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
  return (user: TestActor, opts: { csrf?: boolean } = {}) => {
    const json = JSON.stringify(user);
    return {
      get: (url: string) => http.get(url).set(TEST_ACTOR_HEADER, json),
      post: (url: string) => {
        const r = http.post(url).set(TEST_ACTOR_HEADER, json);
        return opts.csrf === false ? r : r.set("x-csrf-token", csrf.tokenFor(FakeAccess.identify(user).sessionId));
      },
    };
  };
}
