import type { AppEnv, AppConfig } from "./schema";

export interface Profile {
  email: AppConfig["email"]["provider"];
  storage: AppConfig["storage"]["provider"];
  errorTracking: AppConfig["errorTracking"]["provider"];
  demo: AppConfig["demo"];
  auditEnforcement: AppConfig["auditEnforcement"];
  apiDocs: boolean;
  logLevel: string;
}

const off = { oneClickLogin: false, lockRiskySettings: false, resetCron: null } as const;

export const PROFILES: Record<AppEnv, Profile> = {
  demo: {
    email: "capture",
    storage: "local",
    errorTracking: "none",
    demo: { oneClickLogin: true, lockRiskySettings: true, resetCron: "0 */6 * * *" },
    auditEnforcement: "throw",
    apiDocs: false,
    logLevel: "info",
  },
  development: {
    email: "mailpit",
    storage: "local",
    errorTracking: "none",
    demo: off,
    auditEnforcement: "throw",
    apiDocs: true,
    logLevel: "debug",
  },
  staging: {
    email: "smtp",
    storage: "s3",
    errorTracking: "sentry",
    demo: off,
    auditEnforcement: "throw",
    apiDocs: false,
    logLevel: "info",
  },
  production: {
    email: "smtp",
    storage: "s3",
    errorTracking: "sentry",
    demo: off,
    auditEnforcement: "log",
    apiDocs: false,
    logLevel: "info",
  },
};

export const MAILPIT_DEFAULTS = { host: "localhost", port: 1025 } as const;
export const LOCAL_STORAGE_DIR = "./.data/uploads";
