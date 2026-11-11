import { z } from "zod";
import type { StoreConfigInput } from "@platform/core";

export const APP_ENVS = ["demo", "development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export interface AppConfig {
  env: AppEnv;
  port: number;
  logLevel: string;
  apiDocs: boolean;
  databaseUrl: string;
  apiUrl: string;
  adminUrl: string;
  session: { secret: string; cookieName: "sid"; idleHours: 12; absoluteDays: 7 };
  encryptionKey: Buffer;
  email: {
    provider: "capture" | "mailpit" | "smtp";
    from: string;
    smtp?: { host: string; port: number; user?: string; password?: string };
  };
  storage:
    | { provider: "local"; dir: string }
    | {
        provider: "s3";
        region: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        endpoint?: string;
        publicUrl?: string;
      };
  errorTracking: { provider: "none" } | { provider: "sentry"; dsn: string };
  demo: { oneClickLogin: boolean; lockRiskySettings: boolean; resetCron: string | null };
  modules: Record<string, Record<string, unknown>>;
  branding: StoreConfigInput["branding"];
  locale: StoreConfigInput["locale"];
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: ConfigIssue[];
  constructor(issues: ConfigIssue[]) {
    super(`Invalid configuration:\n${issues.map((i) => `${i.path}: ${i.message}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const required = (name: string) => z.string({ error: `${name} is required` }).min(1, `${name} is required`);
const optional = z.string().min(1).optional();

/** Raw environment variables. Empty strings are treated as unset by the loader. */
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  DATABASE_URL: required("DATABASE_URL"),
  API_URL: z.url({ error: "API_URL must be a URL" }),
  ADMIN_URL: z.url({ error: "ADMIN_URL must be a URL" }),
  SESSION_SECRET: required("SESSION_SECRET").min(32, "SESSION_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: required("ENCRYPTION_KEY"),
  EMAIL_FROM: required("EMAIL_FROM"),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  STORAGE_LOCAL_DIR: optional,
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_ENDPOINT: optional,
  S3_PUBLIC_URL: optional,
  SENTRY_DSN: optional,
});
export type Env = z.infer<typeof envSchema>;
