import { defineStore } from "@platform/core";
import { ConfigError } from "../src";

export const store = defineStore({
  modules: {},
  branding: { name: "Acme", primaryColor: "#2563eb" },
  locale: { default: "en", currency: "USD", timezone: "UTC" },
});

export const base = {
  DATABASE_URL: "postgres://x",
  API_URL: "http://localhost:4000",
  ADMIN_URL: "http://localhost:3000",
  SESSION_SECRET: "s".repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  EMAIL_FROM: "shop@example.com",
};

export const prod = {
  ...base,
  APP_ENV: "production",
  SMTP_HOST: "h",
  SMTP_PORT: "587",
  SMTP_USER: "u",
  SMTP_PASSWORD: "p",
  S3_REGION: "r",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  SENTRY_DSN: "https://d",
};

export function catchError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw e;
  }
  throw new Error("expected function to throw a ConfigError");
}
