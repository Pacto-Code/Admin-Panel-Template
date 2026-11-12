/** Injection tokens for the values `createApp` provides to every module. */
export const CONFIG = Symbol("CONFIG");
export const DB = Symbol("DB");
export const ERROR_TRACKER = Symbol("ERROR_TRACKER");

export const API_PREFIX = "api/v1";

export interface ErrorTracker {
  capture(error: unknown, context: { requestId?: string }): void;
}
