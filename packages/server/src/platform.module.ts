import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, DiscoveryModule } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import type { AppConfig } from "@platform/config";
import type { Db } from "@platform/db";
import { AuditEnforcementInterceptor } from "./data/audit-enforcement.interceptor";
import { MutationRunner } from "./data/mutation-runner";
import { EventDispatcher } from "./events/dispatcher";
import { EventBus } from "./events/event-bus";
import { ErrorFilter } from "./http/error-filter";
import { HealthController } from "./health.controller";
import { BossJobs } from "./jobs/boss-jobs";
import { InlineJobs } from "./jobs/inline-jobs";
import { JobsService } from "./jobs/jobs.service";
import { AccessGuard } from "./security/access.guard";
import { CsrfService } from "./security/csrf";
import { CONFIG, DB, ERROR_TRACKER, type ErrorTracker } from "./tokens";

const ENHANCER_TOKENS = new Set<unknown>([APP_GUARD, APP_INTERCEPTOR, APP_FILTER, APP_PIPE]);

/**
 * The platform kernel, global to every module.
 *
 * Platform extension points (AUTHENTICATOR, PERMISSION_RESOLVER, AUDIT_RECORDER, MAILER, NOTIFIER, STORAGE)
 * are provided by feature modules. Such a module must be `@Global()` and export its token, so the platform's
 * consumers (AccessGuard, MutationRunner, ...) can resolve it.
 */
@Module({})
export class PlatformModule {
  static register(opts: {
    config: AppConfig;
    db: Db;
    errorTracker: ErrorTracker;
    providers?: Provider[];
    jobs: "boss" | "inline";
  }): DynamicModule {
    return {
      module: PlatformModule,
      global: true,
      imports: [DiscoveryModule, ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }] })],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: opts.config },
        { provide: DB, useValue: opts.db },
        { provide: ERROR_TRACKER, useValue: opts.errorTracker },
        // No local defaults for AUTHENTICATOR / PERMISSION_RESOLVER / AUDIT_RECORDER: a local provider here would
        // shadow the one a @Global module exports. Consumers inject them @Optional() and fall back to the
        // null/no-op implementations. Providers supplied here (tests) do win over a module's.
        ...(opts.providers ?? []),
        { provide: JobsService, useClass: opts.jobs === "inline" ? InlineJobs : BossJobs },
        EventBus,
        EventDispatcher,
        MutationRunner,
        CsrfService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditEnforcementInterceptor },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
      exports: [
        CONFIG,
        DB,
        ERROR_TRACKER,
        CsrfService,
        JobsService,
        EventBus,
        MutationRunner,
        // Supplied providers (e.g. a test MAILER) are injectable everywhere too. Nest's APP_* enhancer tokens
        // are registered per provider and must never be exported.
        ...(opts.providers ?? [])
          .map((p) => (typeof p === "function" ? p : p.provide))
          .filter((token) => !ENHANCER_TOKENS.has(token)),
      ],
    };
  }
}
