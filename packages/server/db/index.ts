import { join } from "node:path";
import type { MigrationSource } from "@platform/db";

export * from "./schema";

/** The platform's own tables. Callers run these before any module's migrations. */
export const platformMigrations: MigrationSource = {
  id: "platform",
  migrationsFolder: join(import.meta.dirname, "migrations"),
};
