import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import type { AppConfig } from "@platform/config";
import type { Db } from "@platform/db";
import { ErrorFilter } from "./http/error-filter";
import { HealthController } from "./health.controller";
import { CONFIG, DB, ERROR_TRACKER, type ErrorTracker } from "./tokens";

@Module({})
export class PlatformModule {
  static register(opts: { config: AppConfig; db: Db; errorTracker: ErrorTracker }): DynamicModule {
    return {
      module: PlatformModule,
      global: true,
      imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }] })],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: opts.config },
        { provide: DB, useValue: opts.db },
        { provide: ERROR_TRACKER, useValue: opts.errorTracker },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
      exports: [CONFIG, DB, ERROR_TRACKER],
    };
  }
}
