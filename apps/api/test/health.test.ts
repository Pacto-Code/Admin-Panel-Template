import "reflect-metadata";
import request from "supertest";
import { it, expect } from "vitest";
import type { AppConfig } from "@platform/config";
import type { Db } from "@platform/db";
import { createApp } from "@platform/server";
import { AppModule } from "../src/app.module";

it("serves health from the platform module through createApp", async () => {
  const config = {
    env: "development",
    logLevel: "silent",
    adminUrl: "http://localhost:3000",
    errorTracking: { provider: "none" },
    demo: { oneClickLogin: false, lockRiskySettings: false, resetCron: null },
  } as AppConfig;
  const app = await createApp({ config, db: {} as Db, modules: [AppModule], jobs: "inline" });
  await app.init();
  const res = await request(app.getHttpServer()).get("/api/v1/health");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: "ok" });
  await app.close();
});
