import { spawnSync } from "node:child_process";

const id = process.argv[2];
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error("Usage: pnpm db:generate <module-id>");
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "drizzle-kit",
    "generate",
    "--dialect",
    "postgresql",
    "--schema",
    `modules/${id}/db/schema.ts`,
    "--out",
    `modules/${id}/db/migrations`,
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
