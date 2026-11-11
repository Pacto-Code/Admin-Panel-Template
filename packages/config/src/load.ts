import type { StoreConfigInput } from "@platform/core";
import { LOCAL_STORAGE_DIR, MAILPIT_DEFAULTS, PROFILES } from "./profiles";
import { APP_ENVS, ConfigError, envSchema, type AppConfig, type AppEnv, type ConfigIssue } from "./schema";

export function loadConfig(input: {
  env: Record<string, string | undefined>;
  store: StoreConfigInput;
}): AppConfig {
  const { store } = input;
  const issues: ConfigIssue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, message });

  // Treat empty strings as unset.
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(input.env)) raw[k] = v === "" ? undefined : v;

  const appEnv = raw.APP_ENV as AppEnv | undefined;
  if (!appEnv || !APP_ENVS.includes(appEnv)) {
    throw new ConfigError([{ path: "APP_ENV", message: `must be one of ${APP_ENVS.join(", ")}` }]);
  }
  const profile = PROFILES[appEnv];
  const live = appEnv === "staging" || appEnv === "production";

  const emailProvider = store.providers?.email ?? profile.email;
  const storageProvider = store.providers?.storage ?? profile.storage;
  const errorProvider = store.providers?.errorTracking ?? profile.errorTracking;

  if (appEnv === "production") {
    if (emailProvider === "capture" || emailProvider === "mailpit") {
      fail("providers.email", `"${emailProvider}" is not allowed in production`);
    }
    if (storageProvider === "local") fail("providers.storage", `"local" is not allowed in production`);
  }

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) fail(String(i.path[0] ?? "env"), i.message);
  }
  const env = parsed.success ? parsed.data : undefined;

  const need = (name: string, value: unknown, why: string) => {
    if (value === undefined || value === "") fail(name, `${name} is required ${why}`);
  };

  let encryptionKey = Buffer.alloc(0);
  if (env) {
    encryptionKey = Buffer.from(env.ENCRYPTION_KEY, "base64");
    if (encryptionKey.length !== 32) fail("ENCRYPTION_KEY", "must be 32 bytes, base64 encoded");
  }

  let smtp: AppConfig["email"]["smtp"];
  if (emailProvider === "smtp") {
    const why = "for the smtp email provider";
    need("SMTP_HOST", raw.SMTP_HOST, why);
    need("SMTP_PORT", raw.SMTP_PORT, why);
    if (live) {
      need("SMTP_USER", raw.SMTP_USER, why);
      need("SMTP_PASSWORD", raw.SMTP_PASSWORD, why);
    }
    if (env?.SMTP_HOST && env.SMTP_PORT) {
      smtp = { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD };
    }
  } else if (emailProvider === "mailpit") {
    smtp = { host: env?.SMTP_HOST ?? MAILPIT_DEFAULTS.host, port: env?.SMTP_PORT ?? MAILPIT_DEFAULTS.port };
  }

  let storage: AppConfig["storage"] = { provider: "local", dir: env?.STORAGE_LOCAL_DIR ?? LOCAL_STORAGE_DIR };
  if (storageProvider === "s3") {
    const why = "for the s3 storage provider";
    need("S3_REGION", raw.S3_REGION, why);
    need("S3_BUCKET", raw.S3_BUCKET, why);
    need("S3_ACCESS_KEY_ID", raw.S3_ACCESS_KEY_ID, why);
    need("S3_SECRET_ACCESS_KEY", raw.S3_SECRET_ACCESS_KEY, why);
    storage = {
      provider: "s3",
      region: env?.S3_REGION ?? "",
      bucket: env?.S3_BUCKET ?? "",
      accessKeyId: env?.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env?.S3_SECRET_ACCESS_KEY ?? "",
      endpoint: env?.S3_ENDPOINT,
      publicUrl: env?.S3_PUBLIC_URL,
    };
  }

  let errorTracking: AppConfig["errorTracking"] = { provider: "none" };
  if (errorProvider === "sentry") {
    need("SENTRY_DSN", raw.SENTRY_DSN, "for the sentry error tracking provider");
    errorTracking = { provider: "sentry", dsn: env?.SENTRY_DSN ?? "" };
  }

  if (issues.length > 0 || !env) throw new ConfigError(issues);

  return {
    env: appEnv,
    port: env.PORT ?? 4000,
    logLevel: env.LOG_LEVEL ?? profile.logLevel,
    apiDocs: profile.apiDocs,
    databaseUrl: env.DATABASE_URL,
    apiUrl: env.API_URL,
    adminUrl: env.ADMIN_URL,
    session: { secret: env.SESSION_SECRET, cookieName: "sid", idleHours: 12, absoluteDays: 7 },
    encryptionKey,
    email: { provider: emailProvider, from: env.EMAIL_FROM, ...(smtp ? { smtp } : {}) },
    storage,
    errorTracking,
    demo: { ...profile.demo },
    modules: store.modules,
    branding: store.branding,
    locale: store.locale,
  };
}
