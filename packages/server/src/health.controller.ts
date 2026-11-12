import { Controller, Get, Inject } from "@nestjs/common";
import type { Db } from "@platform/db";
import { AppError } from "./http/app-error";
import { DB } from "./tokens";

@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get("health")
  check() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    try {
      await this.db.execute("select 1");
    } catch {
      throw new AppError("server.unavailable", 503, "Database unavailable");
    }
    return { status: "ready" };
  }
}
