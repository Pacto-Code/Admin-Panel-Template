import "reflect-metadata";
import type { INestApplication, Provider, Type } from "@nestjs/common";
import request from "supertest";
import { loadConfig, type AppConfig, type AppEnv } from "@platform/config";
import { resolveModules, type ModuleManifest, type StoreConfigInput } from "@platform/core";
import type { Db } from "@platform/db";
import { createTestDatabase } from "@platform/db/testing";
import { platformMigrations } from "../../db";
import { createApp } from "../create-app";
import { AUDIT_RECORDER, type AuditEntryInput } from "../data/audit-tokens";
import { EventBus } from "../events/event-bus";
import { CsrfService } from "../security/csrf";
import { AUTHENTICATOR, PERMISSION_RESOLVER } from "../security/tokens";
import { MAILER, type MailMessage } from "../services/tokens";
import { FakeAccess, FakeMailer, FakeRecorder, TEST_ACTOR_HEADER, type TestActor } from "./fakes";

export type SuperTestAgent = request.Agent;

/** A module as the test app loads it: what modules:sync imports, plus where its migrations live. */
export interface TestModule {
  id: string;
  manifest: ModuleManifest;
  apiModule: Type;
  migrationsFolder: string;
}

export interface TestApp {
  app: INestApplication;
  db: Db;
  config: AppConfig;
  /** An agent signed in as `actor` ("owner" holds every permission the loaded modules declare), with a CSRF token unless `csrf: false`. */
  as(actor: TestActor | "owner", opts?: { csrf?: boolean }): SuperTestAgent;
  /** An agent with no session, sending `Origin: config.adminUrl`. */
  anon(): SuperTestAgent;
  /** Audit entries written so far. Fake: unavailable when the audit module is loaded. */
  recorder: { entries: AuditEntryInput[] };
  /** Mail sent so far. Fake: unavailable when the notifications module is loaded. */
  mail: { sent: MailMessage[] };
  /** Errors the error tracker received (unexpected 500s, failed event deliveries), since logs are silenced. */
  errors: unknown[];
  /** Delivers every pending outbox event, including events published by the handlers it runs. */
  flushEvents(): Promise<void>;
  /** Closes the app and drops its database. */
  close(): Promise<void>;
}

const TEST_ENV = {
  LOG_LEVEL: "silent",
  API_URL: "http://localhost:4000",
  ADMIN_URL: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  EMAIL_FROM: "store@example.com",
  // Placeholders so every profile's provider checks pass; no test talks to these services.
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  SMTP_USER: "test",
  SMTP_PASSWORD: "test",
  S3_REGION: "us-east-1",
  S3_BUCKET: "test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  SENTRY_DSN: "https://key@sentry.example.com/1",
};

const OWNER: TestActor = {
  userId: "00000000-0000-7000-8000-000000000001",
  email: "owner@example.com",
  permissions: [],
  roleKeys: ["owner"],
};

function unavailable(what: string, moduleId: string): never {
  throw new Error(`${what} is a fake, and the "${moduleId}" module is loaded: assert on its real data instead`);
}

/**
 * Boots the platform plus `modules` (dependencies first) on a fresh, migrated database, with inline jobs.
 * Unless `realAuth` is set, `as()` drives a fake authenticator and permission resolver.
 */
export async function createTestApp(opts: {
  modules: TestModule[];
  env?: AppEnv;
  store?: Partial<StoreConfigInput>;
  realAuth?: boolean;
}): Promise<TestApp> {
  const store: StoreConfigInput = {
    branding: { name: "Test Store", primaryColor: "#2563eb" },
    locale: { default: "en", currency: "USD", timezone: "UTC" },
    ...opts.store,
    modules: { ...Object.fromEntries(opts.modules.map((m) => [m.id, {}])), ...opts.store?.modules },
  };
  const byId = new Map(opts.modules.map((m) => [m.id, m]));
  const ordered = resolveModules(store.modules, Object.fromEntries(opts.modules.map((m) => [m.id, m.manifest]))).map(
    (manifest) => byId.get(manifest.id)!,
  );

  const { db, url, drop } = await createTestDatabase([
    platformMigrations,
    ...ordered.map((m) => ({ id: m.id, migrationsFolder: m.migrationsFolder })),
  ]);

  try {
    const config = loadConfig({ env: { ...TEST_ENV, APP_ENV: opts.env ?? "development", DATABASE_URL: url }, store });
    const access = new FakeAccess();
    const recorder = byId.has("audit") ? undefined : new FakeRecorder();
    const mail = byId.has("notifications") ? undefined : new FakeMailer();
    const errors: unknown[] = [];
    const providers: Provider[] = [
      ...(opts.realAuth
        ? []
        : [
            { provide: AUTHENTICATOR, useValue: access },
            { provide: PERMISSION_RESOLVER, useValue: access },
          ]),
      ...(recorder ? [{ provide: AUDIT_RECORDER, useValue: recorder }] : []),
      ...(mail ? [{ provide: MAILER, useValue: mail }] : []),
    ];

    const app = await createApp({
      config,
      db,
      modules: ordered.map((m) => m.apiModule),
      providers,
      jobs: "inline",
      errorTracker: { capture: (error) => errors.push(error) },
    });
    try {
      await app.init();
    } catch (err) {
      await app.close().catch(() => {});
      throw err;
    }

    const origin = new URL(config.adminUrl).origin;
    const csrf = app.get(CsrfService);
    const ownerPermissions = ordered.flatMap((m) => m.manifest.permissions.map((p) => p.key));
    const anon = () => request.agent(app.getHttpServer()).set("Origin", origin);

    return {
      app,
      db,
      config,
      errors,
      anon,
      as(actor, asOpts = {}) {
        if (opts.realAuth) throw new Error("as() drives the fake authenticator, which realAuth replaces");
        const resolved = actor === "owner" ? { ...OWNER, permissions: ownerPermissions } : actor;
        const agent = anon().set(TEST_ACTOR_HEADER, JSON.stringify(resolved));
        return asOpts.csrf === false
          ? agent
          : agent.set("x-csrf-token", csrf.tokenFor(FakeAccess.identify(resolved).sessionId));
      },
      get recorder() {
        return recorder ?? unavailable("recorder", "audit");
      },
      get mail() {
        return mail ?? unavailable("mail", "notifications");
      },
      async flushEvents() {
        const bus = app.get(EventBus);
        let sent: number;
        do sent = await bus.dispatchPending();
        while (sent > 0);
      },
      async close() {
        try {
          await app.close();
        } finally {
          await drop();
        }
      },
    };
  } catch (err) {
    await drop();
    throw err;
  }
}
