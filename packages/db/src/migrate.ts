import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

export interface MigrationSource {
  id: string;
  migrationsFolder: string;
}

/** Applies each source in order, with a tracking table per source. */
export async function runMigrations(db: Db, sources: MigrationSource[]): Promise<void> {
  for (const source of sources) {
    await migrate(db, {
      migrationsFolder: source.migrationsFolder,
      migrationsTable: "__migrations_" + source.id.replaceAll("-", "_"),
    });
  }
}
