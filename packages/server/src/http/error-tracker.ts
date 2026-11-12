import type { AppConfig } from "@platform/config";
import type { ErrorTracker } from "../tokens";

/** "none" is a no-op; "sentry" loads the SDK lazily and initialises it once. */
export async function createErrorTracker(config: AppConfig): Promise<ErrorTracker> {
  if (config.errorTracking.provider !== "sentry") return { capture() {} };
  const Sentry = await import("@sentry/node");
  Sentry.init({ dsn: config.errorTracking.dsn, environment: config.env });
  return {
    capture(error, context) {
      Sentry.captureException(error, { tags: { requestId: context.requestId } });
    },
  };
}
