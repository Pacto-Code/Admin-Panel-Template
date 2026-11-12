import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTestDatabase } from "@platform/db/testing";
import { findUnguardedRoutes } from "../../src";
import { buildApp } from "./fixtures";

let app: INestApplication;
let drop: () => Promise<void>;
beforeAll(async () => {
  const t = await createTestDatabase([]);
  drop = t.drop;
  app = await buildApp(t.db, "dev");
});
afterAll(async () => {
  await app.close();
  await drop();
});

describe("findUnguardedRoutes", () => {
  it("lists undecorated routes", () => expect(findUnguardedRoutes(app)).toEqual(["GET /api/v1/test/bare"]));
});
