import "reflect-metadata";
import { Controller, Get, Module, Post } from "@nestjs/common";
import { z } from "zod";
import type { AppConfig } from "@platform/config";
import { ConflictError, type Db } from "@platform/db";
import { AppError, createApp, Public, ZodBody, type ErrorTracker } from "../src";

const EchoBody = z.object({ email: z.email(), pad: z.string().optional() });

@Public()
@Controller("test")
export class TestController {
  @Get("boom")
  boom() {
    throw new AppError("x.y", 418, "Teapot");
  }
  @Post("echo")
  echo(@ZodBody(EchoBody) body: z.infer<typeof EchoBody>) {
    return { email: body.email };
  }
  @Get("crash")
  crash() {
    throw new Error("secret internal detail");
  }
  @Get("conflict")
  conflict() {
    throw new ConflictError();
  }
}

@Module({ controllers: [TestController] })
export class TestModule {}

export class FakeTracker implements ErrorTracker {
  captured: unknown[] = [];
  capture(error: unknown) {
    this.captured.push(error);
  }
}

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: "development",
    port: 0,
    logLevel: "silent",
    adminUrl: "http://localhost:3000",
    session: { secret: "test-session-secret-test-session-secret", cookieName: "sid", idleHours: 12, absoluteDays: 7 },
    demo: { oneClickLogin: false, lockRiskySettings: false, resetCron: null },
    errorTracking: { provider: "none" },
    ...overrides,
  } as AppConfig;
}

export async function makeApp(db: Db, tracker = new FakeTracker(), config = makeConfig()) {
  const app = await createApp({ config, db, modules: [TestModule], errorTracker: tracker });
  await app.init();
  return { app, tracker };
}
