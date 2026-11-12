import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ModuleManifest } from "@platform/core";
import { planSync } from "./plan";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function discover(): Promise<Record<string, ModuleManifest>> {
  const dir = join(root, "modules");
  const available: Record<string, ModuleManifest> = {};
  if (!existsSync(dir)) return available;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, "manifest.ts");
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const { manifest } = (await import(pathToFileURL(file).href)) as { manifest: ModuleManifest };
    available[manifest.id] = manifest;
  }
  return available;
}

const check = process.argv.includes("--check");
const { default: store } = (await import(pathToFileURL(join(root, "store.config.ts")).href)) as {
  default: Parameters<typeof planSync>[0];
};
const { apiFile, adminFile } = planSync(store, await discover());

const targets = [
  { path: "apps/api/src/modules.generated.ts", content: apiFile },
  { path: "apps/admin/src/modules.generated.ts", content: adminFile },
];

if (check) {
  const drifted = targets.filter((t) => {
    const file = join(root, t.path);
    return !existsSync(file) || readFileSync(file, "utf8") !== t.content;
  });
  for (const t of drifted) console.error(`Drift: ${t.path} is out of date. Run pnpm modules:sync`);
  process.exit(drifted.length ? 1 : 0);
}
for (const t of targets) writeFileSync(join(root, t.path), t.content);
console.log("modules:sync wrote", targets.map((t) => t.path).join(", "));
