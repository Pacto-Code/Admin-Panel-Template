import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { it, expect } from "vitest";
import { configureApp } from "@platform/server";
import { AppModule } from "../src/app.module";

it("serves health from a controller defined in a workspace package", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  const res = await request(app.getHttpServer()).get("/api/v1/health");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: "ok" });
  await app.close();
});
