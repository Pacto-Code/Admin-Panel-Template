import type { StoreConfigInput } from "@platform/core";
import { loadConfig } from "./load";
import type { AppConfig } from "./schema";

/** The only place in the codebase that reads process.env. */
export function loadConfigFromProcess(store: StoreConfigInput): AppConfig {
  return loadConfig({ env: process.env, store });
}
