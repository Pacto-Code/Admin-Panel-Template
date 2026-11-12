import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultName, scaffoldModule } from "./scaffold";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** Runs pnpm in a shell (pnpm is a .cmd on Windows). Arguments are fixed words or a validated kebab-case id. */
function pnpm(root: string, args: string[]): void {
  const result = spawnSync(`pnpm ${args.join(" ")}`, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed`);
}

/** `pnpm create:module <id> ["Display name"]`: writes modules/<id>, links it into the workspace and generates its first migration. */
export async function run(args: string[], opts: { root?: string } = {}): Promise<void> {
  const root = opts.root ?? REPO_ROOT;
  const [id, name] = args;
  if (!id) throw new Error('Usage: pnpm create:module <id> ["Display name"]');
  const files = scaffoldModule(id, name ?? defaultName(id));
  if (existsSync(join(root, "modules", id))) throw new Error(`Module "${id}" already exists in modules/${id}`);

  for (const file of files) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  // The new folder is a workspace package: install links its dependencies before drizzle-kit loads its schema.
  pnpm(root, ["install", "--prefer-offline"]);
  pnpm(root, ["db:generate", id]);

  const key = id.includes("-") ? JSON.stringify(id) : id;
  console.log(`\nCreated modules/${id}. To enable it, add it to \`modules\` in store.config.ts and regenerate the imports:`);
  console.log(`    ${key}: {},`);
  console.log("    pnpm modules:sync");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
