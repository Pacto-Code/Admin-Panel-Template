import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import type { AppConfig } from "@platform/config";
import type { Db } from "@platform/db";
import { AUDIT_RECORDER, noopAuditRecorder } from "./data/audit-tokens";
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
import {
  AUTHENTICATOR,
  PERMISSION_RESOLVER,
  emptyPermissionResolver,
  nullAuthenticator,
} from "./security/tokens";
import { CONFIG, DB, ERROR_TRACKER, type ErrorTracker } from "./tokens";

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
        { provide: AUTHENTICATOR, useValue: nullAuthenticator },
        { provide: PERMISSION_RESOLVER, useValue: emptyPermissionResolver },
        { provide: AUDIT_RECORDER, useValue: noopAuditRecorder },
        // Supplied providers come after the defaults, so a module can override AUTHENTICATOR / PERMISSION_RESOLVER / AUDIT_RECORDER.
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
        AUTHENTICATOR,
        PERMISSION_RESOLVER,
        AUDIT_RECORDER,
        CsrfService,
        JobsService,
        EventBus,
        MutationRunner,
        // Supplied providers (e.g. MAILER) are injectable everywhere too.
        ...(opts.providers ?? []).map((p) => (typeof p === "function" ? p : p.provide)),
      ],
    };
  }
}
