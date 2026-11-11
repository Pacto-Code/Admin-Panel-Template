export interface StoreConfigInput {
  modules: Record<string, Record<string, unknown>>;
  providers?: {
    email?: "capture" | "mailpit" | "smtp";
    storage?: "local" | "s3";
    errorTracking?: "none" | "sentry";
  };
  branding: { name: string; primaryColor: string; logo?: string };
  locale: { default: string; currency: string; timezone: string };
}

export function defineStore(c: StoreConfigInput): StoreConfigInput {
  return c;
}
