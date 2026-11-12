import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Type } from "@nestjs/common";
import { afterAll, expect, it } from "vitest";
import type { ModuleManifest } from "@platform/core";
import { scaffoldModule } from "create-module/scaffold";
import { createTestApp, describeModuleContract, type TestModule } from "../../src/testing";

// The scaffolded module must resolve @nestjs/*, drizzle-orm and @platform/* like a real module, so it is
// written inside this package (git-ignored test/.fixtures) rather than an OS temp dir with no node_modules.
const repoRoot = resolve(import.meta.dirname, "../../../..");
const fixtureRoot = join(import.meta.dirname, "../.fixtures", `contract-${randomBytes(4).toString("hex")}`);
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

for (const file of scaffoldModule("example", "Example")) {
  const target = join(fixtureRoot, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
}
const moduleDir = join(fixtureRoot, "modules/example");
// drizzle-kit's bin runs under this Node directly, so no shell is involved and paths may contain spaces.
const generated = spawnSync(
  process.execPath,
  [
    join(repoRoot, "node_modules/drizzle-kit/bin.cjs"),
    "generate",
    "--dialect",
    "postgresql",
    "--schema",
    relative(repoRoot, join(moduleDir, "db/schema.ts")).replaceAll("\\", "/"),
    "--out",
    relative(repoRoot, join(moduleDir, "db/migrations")).replaceAll("\\", "/"),
  ],
  { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
);
if (generated.status !== 0) throw new Error(`drizzle-kit generate failed:\n${generated.stdout}\n${generated.stderr}`);

const load = async <T>(path: string) => (await import(pathToFileURL(join(moduleDir, path)).href)) as T;
const { manifest } = await load<{ manifest: ModuleManifest }>("manifest.ts");
const { apiModule } = await load<{ apiModule: Type }>("api/index.ts");
const exampleModule: TestModule = {
  id: manifest.id,
  manifest,
  apiModule,
  migrationsFolder: join(moduleDir, "db/migrations"),
};

describeModuleContract({ module: exampleModule, dependencies: [] });

it("serves the example route when enabled and 404s when not", async () => {
  const on = await createTestApp({ modules: [exampleModule] });
  try {
    const res = await on.as("owner").get("/api/v1/admin/example/items");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], total: 0, page: 1, pageSize: 25 });
  } finally {
    await on.close();
  }
  const off = await createTestApp({ modules: [] });
  try {
    expect((await off.as("owner").get("/api/v1/admin/example/items")).status).toBe(404);
  } finally {
    await off.close();
  }
});
