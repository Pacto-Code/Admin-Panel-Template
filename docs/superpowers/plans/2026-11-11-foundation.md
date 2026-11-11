# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform layer of the e-commerce admin template: a module system, environment-aware config, staff sign-in, roles, audit log, and an admin shell with a reusable UI kit.

**Architecture:** A pnpm + Turborepo monorepo. Features are self-contained folders under `modules/`, each with a manifest, a NestJS API part, admin screens and its own Drizzle migrations. `store.config.ts` lists enabled modules; `pnpm modules:sync` generates the static imports for the API and admin apps. Shared server infrastructure lives in `packages/server`; modules reach each other through injected interfaces and an outbox-backed event bus.

**Tech Stack:** TypeScript, NestJS, Next.js (App Router), PostgreSQL 16, Drizzle ORM, pg-boss, Zod, Vitest, Playwright, Tailwind, shadcn/ui, TanStack Query and Table, React Hook Form, next-intl.

**Spec:** `docs/superpowers/specs/2026-11-11-foundation-design.md`

## Global Constraints

- Node 22. pnpm 10 (`packageManager: pnpm@10.28.0`).
- Install the current stable major of each library. As of 2026-11-11 these are: Next 16, NestJS 12, drizzle-orm 0.45, drizzle-kit 0.31, pg-boss 12, Zod 4, Vitest 5, Playwright 1.65, Tailwind 4, TanStack Query 5, TanStack Table 9, next-intl 4, React Hook Form 7, TypeScript 7. Read each library's current docs for API details; do not rely on memory of older majors. If `tsc --noEmit` under TypeScript 7 rejects decorator metadata settings, pin `typescript@^5.9` and note it in the README.
- Package names: `@platform/<name>` for `packages/*`, `@modules/<id>` for `modules/*`.
- Internal packages export TypeScript source (no per-package build). The API is bundled with tsup using SWC for decorator metadata; tests run on Vitest with `unplugin-swc`.
- Permission keys are `<module>.<resource>.<action>`, prefixed with the module id.
- Database tables are prefixed with the module id: `auth_users`, `audit_entries`.
- Primary keys are UUIDv7, generated in the application.
- Every table has `created_at` and `updated_at`. Business records are soft-deleted with `deleted_at`.
- Editable records carry `version`. A stale version returns HTTP 409.
- Money is an integer in minor units plus an ISO currency code.
- Only `packages/config` reads `process.env`. No code branches on `APP_ENV`.
- Every API route declares `@RequirePermission`, `@Authenticated` or `@Public`.
- REST under `/api/v1`. Staff routes under `/api/v1/admin`. `/api/v1/store` is reserved and unused.
- Error body: `{ "error": { "code", "message", "fields", "requestId" } }`.
- List endpoints take `page`, `pageSize` (default 25, max 100), `sort`, `filter[...]` and return `{ data, total, page, pageSize }`.
- All admin UI text goes through translation files (English only for now). Use CSS logical properties. Controls are keyboard reachable and labelled; contrast meets WCAG AA.
- Test-first: write the failing test, watch it fail, implement, watch it pass, commit.
- Tests need a PostgreSQL 16 server. They read `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`) and create a fresh, uniquely named database per test file.
- Ports: API 4000, admin 3000, PostgreSQL 5432, Mailpit SMTP 1025 and UI 8025.
- Commit after every task with the message given. Git author is already configured in this clone.

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task named.

1. **Email typed with capitals or stray spaces** (`" Owner@Example.com "`) signs in as the same account and cannot create a duplicate. Task 10.
2. **Invite or reset link that is expired, already used or mangled** gives a clear "link no longer valid" error, never a 500. Task 11.
3. **CSV export of a cell beginning with `=`, `+`, `-` or `@`** is escaped so a spreadsheet does not run it as a formula. Task 6.
4. **A module removed from `store.config.ts` while roles, settings or saved views still mention it** causes no crash; its permissions and settings are ignored and return when it is re-enabled. Tasks 13, 15 and 19.
5. **Session expiring while someone is mid-task** sends them to the login page and returns them to the page they were on after signing in. Task 19.

## File Structure

```
package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  eslint.config.js
store.config.ts                     enabled modules and providers for this clone
docker-compose.dev.yml              PostgreSQL + Mailpit for local work
.env.<profile>.example              demo, development, staging, production
apps/api/                           NestJS host: main.ts, modules.generated.ts, cli/
apps/admin/                         Next.js host: catch-all route, shell, modules.generated.ts
packages/core/                      manifest types, validation, resolver, registry, admin page types
packages/config/                    env + store schema, profiles, loadConfig
packages/db/                        client, column helpers, migration runner, test database
packages/server/                    HTTP conventions, guards, request context, mutation runner,
                                    outbox + events, jobs, storage, contract suite, test app
packages/ui/                        presentational components: primitives, data table, forms, feedback
packages/admin/                     admin runtime kit for module screens: API client, session,
                                    permissions, list hooks, i18n helpers
packages/api-client/                generated OpenAPI types
modules/{auth,access,audit,settings,notifications}/
  manifest.ts  api/  admin/  db/schema.ts  db/migrations/
tools/modules-sync/                 pnpm modules:sync
tools/create-module/                pnpm create:module
tools/vitest-preset/                shared Vitest config
e2e/                                Playwright tests
deploy/                             Dockerfiles, compose, Caddyfile
```

---

## Phase A: Kernel

### Task 1: Workspace and toolchain

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.gitignore`, `.nvmrc`, `docker-compose.dev.yml`
- Create: `tools/vitest-preset/index.ts`
- Create: `packages/server/src/health.controller.ts`, `packages/server/src/index.ts`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/tsup.config.ts`
- Test: `apps/api/test/health.test.ts`, `tools/lint-tests/process-env.test.ts`

**Interfaces:**
- Produces: root scripts `dev`, `build`, `lint`, `typecheck`, `test`; `GET /api/v1/health` returning `{ "status": "ok" }`; `vitestPreset(dir: string)` exported from `tools/vitest-preset`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/health.test.ts
it("serves health from a controller defined in a workspace package", async () => {
  const app = await NestFactory.create(AppModule); await app.init();
  const res = await request(app.getHttpServer()).get("/api/v1/health");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: "ok" });
});

// tools/lint-tests/process-env.test.ts
it("flags process.env outside packages/config", async () => {
  const [r] = await new ESLint().lintText("export const x = process.env.FOO;",
    { filePath: "modules/auth/api/x.ts" });
  expect(r.messages.map((m) => m.message).join()).toContain("@platform/config");
});
it("allows process.env inside packages/config", async () => {
  const [r] = await new ESLint().lintText("export const x = process.env.FOO;",
    { filePath: "packages/config/src/from-process.ts" });
  expect(r.errorCount).toBe(0);
});
```

- [ ] **Step 2: Run `pnpm test`.** Expected: FAIL, nothing exists yet.
- [ ] **Step 3: Scaffold the workspace.** Workspace globs: `apps/*`, `packages/*`, `modules/*`, `tools/*`. `tsconfig.base.json` is strict with `experimentalDecorators` and `emitDecoratorMetadata`. The lint rule uses `no-restricted-properties` on `process.env` with the message `Read configuration through @platform/config`. `docker-compose.dev.yml` runs `postgres:16` (user and password `postgres`, database `admin_dev`) and Mailpit. `HealthController` lives in `packages/server` and is imported by `apps/api`; the global prefix is `api/v1`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Prove the production bundle.** Run `pnpm --filter api build && node apps/api/dist/main.js &` then `curl -s localhost:4000/api/v1/health`. Expected: `{"status":"ok"}`. Stop the process.
- [ ] **Step 6: Commit.** `chore: scaffold workspace, toolchain and health endpoint`

### Task 2: Module contract (`@platform/core`)

**Files:**
- Create: `packages/core/src/{manifest,resolve,registry,store,admin,index}.ts`
- Test: `packages/core/test/{manifest,resolve,registry,match-page}.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PermissionDef { key: string; label: string }
export interface NavItem { label: string; path: string; icon: string; permission: string; order: number;
  feature?: string } // shown only when PublicConfig.features includes it
export interface SwitchDef { key: string; label: string; default: boolean }
export interface ModuleManifest {
  id: string; name: string; core?: boolean; dependsOn?: string[];
  permissions: PermissionDef[]; nav?: NavItem[];
  options?: ZodObject; settings?: ZodObject; switches?: SwitchDef[];
  events?: { emits: string[]; handles: string[] };
}
export function validateManifest(m: ModuleManifest): string[];
export function defineManifest(m: ModuleManifest): ModuleManifest; // throws ModuleConfigError
export class ModuleConfigError extends Error { issues: string[] }
export function resolveModules(enabled: Record<string, unknown>,
  available: Record<string, ModuleManifest>): ModuleManifest[]; // dependency order
export class ModuleRegistry {
  constructor(manifests: ModuleManifest[]);
  all(): ModuleManifest[]; get(id: string): ModuleManifest | undefined; has(id: string): boolean;
  permissionKeys(): string[]; nav(): (NavItem & { moduleId: string })[];
}
export interface StoreConfigInput {
  modules: Record<string, Record<string, unknown>>;
  providers?: { email?: "capture" | "mailpit" | "smtp"; storage?: "local" | "s3";
                errorTracking?: "none" | "sentry" };
  branding: { name: string; primaryColor: string; logo?: string };
  locale: { default: string; currency: string; timezone: string };
}
export function defineStore(c: StoreConfigInput): StoreConfigInput;

export type PageAccess = string | "authenticated" | "public"; // string = permission key
export interface AdminPage { path: string; access: PageAccess; layout: "app" | "auth";
  load: () => Promise<{ default: ComponentType<{ params: Record<string, string> }> }> }
export interface AdminWidget { id: string; title: string; permission: string;
  size: "sm" | "md" | "lg"; load: () => Promise<{ default: ComponentType }> }
export interface SearchHit { title: string; subtitle?: string; href: string }
export interface SearchSource { id: string; permission: string; search(q: string): Promise<SearchHit[]> }
export interface PaletteCommand { id: string; label: string; permission: string; href: string }
export interface AdminModuleDef { id: string; pages: AdminPage[]; widgets?: AdminWidget[];
  search?: SearchSource[]; commands?: PaletteCommand[];
  topBar?: { id: string; load: () => Promise<{ default: ComponentType }> }[];
  messages: Record<string, () => Promise<{ default: Record<string, unknown> }>> }
export function matchPage(pages: AdminPage[], pathname: string):
  { page: AdminPage; params: Record<string, string> } | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
const audit: ModuleManifest = { id: "audit", name: "Audit", permissions: [{ key: "audit.entry.read", label: "View" }] };
it("accepts a valid manifest", () => expect(validateManifest(audit)).toEqual([]));
it("rejects a non-kebab id", () =>
  expect(validateManifest({ ...audit, id: "Audit_Log" })).toContain('Module id "Audit_Log" must be kebab-case'));
it("rejects a permission outside the module prefix", () =>
  expect(validateManifest({ ...audit, permissions: [{ key: "orders.entry.read", label: "x" }] }))
    .toContain('Permission "orders.entry.read" must start with "audit."'));
it("rejects a nav item whose permission is not declared", () =>
  expect(validateManifest({ ...audit, nav: [{ label: "A", path: "/audit", icon: "list", permission: "audit.x.y", order: 1 }] }))
    .toContain('Nav item "/audit" uses undeclared permission "audit.x.y"'));

const a = { id: "a", name: "A", core: true, permissions: [] };
const b = { id: "b", name: "B", dependsOn: ["a"], permissions: [] };
it("orders dependencies first", () =>
  expect(resolveModules({ b: {}, a: {} }, { a, b }).map((m) => m.id)).toEqual(["a", "b"]));
it("names an unknown module", () =>
  expect(() => resolveModules({ a: {}, zzz: {} }, { a })).toThrow('Unknown module "zzz"'));
it("names a missing dependency", () =>
  expect(() => resolveModules({ b: {} }, { a: { ...a, core: false }, b })).toThrow('Module "b" requires "a", which is not enabled'));
it("requires core modules", () =>
  expect(() => resolveModules({}, { a })).toThrow('Core module "a" must be enabled'));
it("detects a cycle", () =>
  expect(() => resolveModules({ a: {}, b: {} }, { a: { ...a, dependsOn: ["b"] }, b })).toThrow("Dependency cycle"));
it("validates options against the module schema", () =>
  expect(() => resolveModules({ a: { retentionDays: "x" } },
    { a: { ...a, options: z.object({ retentionDays: z.number() }) } })).toThrow('Module "a" option "retentionDays"'));

it("matches a parameterised path", () =>
  expect(matchPage([{ path: "/roles/:id", access: "access.role.read", layout: "app", load }], "/roles/42")?.params).toEqual({ id: "42" }));
it("prefers a static path over a parameter", () =>
  expect(matchPage([{ ...page, path: "/roles/:id" }, { ...page, path: "/roles/new" }], "/roles/new")?.page.path).toBe("/roles/new"));
it("returns null for an unknown path", () => expect(matchPage([], "/nope")).toBeNull());
```

- [ ] **Step 2: Run `pnpm --filter @platform/core test`.** Expected: FAIL, exports missing.
- [ ] **Step 3: Implement the exports above.** `resolveModules` collects every problem into one `ModuleConfigError` (its message joins the issues with newlines). `registry.nav()` sorts by `order`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(core): module manifest, resolver, registry and page matcher`

### Task 3: Configuration and profiles (`@platform/config`)

**Files:**
- Create: `packages/config/src/{schema,profiles,load,from-process,index}.ts`
- Create: `.env.demo.example`, `.env.development.example`, `.env.staging.example`, `.env.production.example`
- Test: `packages/config/test/{load,production-guards}.test.ts`

**Interfaces:**
- Consumes: `StoreConfigInput` from Task 2.
- Produces:

```ts
export type AppEnv = "demo" | "development" | "staging" | "production";
export interface AppConfig {
  env: AppEnv; port: number; logLevel: string; apiDocs: boolean;
  databaseUrl: string; apiUrl: string; adminUrl: string;
  session: { secret: string; cookieName: "sid"; idleHours: 12; absoluteDays: 7 };
  encryptionKey: Buffer; // 32 bytes, from base64 ENCRYPTION_KEY
  email: { provider: "capture" | "mailpit" | "smtp"; from: string;
           smtp?: { host: string; port: number; user?: string; password?: string } };
  storage: { provider: "local"; dir: string } |
           { provider: "s3"; region: string; bucket: string; accessKeyId: string;
             secretAccessKey: string; endpoint?: string; publicUrl?: string };
  errorTracking: { provider: "none" } | { provider: "sentry"; dsn: string };
  demo: { oneClickLogin: boolean; lockRiskySettings: boolean; resetCron: string | null };
  modules: Record<string, Record<string, unknown>>;
  branding: StoreConfigInput["branding"]; locale: StoreConfigInput["locale"];
}
export class ConfigError extends Error { issues: { path: string; message: string }[] }
export function loadConfig(input: { env: Record<string, string | undefined>; store: StoreConfigInput }): AppConfig;
export function loadConfigFromProcess(store: StoreConfigInput): AppConfig; // the only reader of process.env
```

- Environment variables: `APP_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `API_URL`, `ADMIN_URL`, `SESSION_SECRET` (min 32 chars), `ENCRYPTION_KEY`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `STORAGE_LOCAL_DIR`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_PUBLIC_URL`, `SENTRY_DSN`.
- Profile defaults:

| | demo | development | staging | production |
|---|---|---|---|---|
| email | capture | mailpit | smtp | smtp |
| storage | local | local | s3 | s3 |
| errorTracking | none | none | sentry | sentry |
| demo.oneClickLogin, lockRiskySettings | true | false | false | false |
| demo.resetCron | `0 */6 * * *` | null | null | null |
| apiDocs | false | true | false | false |
| logLevel | info | debug | info | info |

`mailpit` defaults `SMTP_HOST=localhost`, `SMTP_PORT=1025`. `local` defaults `STORAGE_LOCAL_DIR=./.data/uploads`.

- [ ] **Step 1: Write the failing tests**

```ts
const store = defineStore({ modules: {}, branding: { name: "Acme", primaryColor: "#2563eb" },
  locale: { default: "en", currency: "USD", timezone: "UTC" } });
const base = { DATABASE_URL: "postgres://x", API_URL: "http://localhost:4000", ADMIN_URL: "http://localhost:3000",
  SESSION_SECRET: "s".repeat(32), ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), EMAIL_FROM: "shop@example.com" };
const prod = { ...base, APP_ENV: "production", SMTP_HOST: "h", SMTP_PORT: "587", SMTP_USER: "u", SMTP_PASSWORD: "p",
  S3_REGION: "r", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", SENTRY_DSN: "https://d" };

it("applies development defaults", () => {
  const c = loadConfig({ env: { ...base, APP_ENV: "development" }, store });
  expect(c.email).toMatchObject({ provider: "mailpit", smtp: { host: "localhost", port: 1025 } });
  expect(c.storage.provider).toBe("local"); expect(c.apiDocs).toBe(true);
});
it("applies demo defaults", () => {
  const c = loadConfig({ env: { ...base, APP_ENV: "demo" }, store });
  expect(c.email.provider).toBe("capture");
  expect(c.demo).toEqual({ oneClickLogin: true, lockRiskySettings: true, resetCron: "0 */6 * * *" });
});
it("lets store.config override a provider", () =>
  expect(loadConfig({ env: { ...base, APP_ENV: "development" }, store: { ...store, providers: { email: "capture" } } })
    .email.provider).toBe("capture"));
it("names every missing variable at once", () => {
  const err = catchError(() => loadConfig({ env: { APP_ENV: "development" }, store }));
  expect(err.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["DATABASE_URL", "SESSION_SECRET", "ENCRYPTION_KEY"]));
});
it("rejects a short session secret", () =>
  expect(() => loadConfig({ env: { ...base, APP_ENV: "development", SESSION_SECRET: "short" }, store })).toThrow("SESSION_SECRET"));
it("boots production with real providers", () => expect(loadConfig({ env: prod, store }).env).toBe("production"));
it.each([
  [{ providers: { email: "capture" } }, "providers.email"],
  [{ providers: { email: "mailpit" } }, "providers.email"],
  [{ providers: { storage: "local" } }, "providers.storage"],
])("production rejects %j", (override, path) =>
  expect(catchError(() => loadConfig({ env: prod, store: { ...store, ...override } })).issues[0].path).toBe(path));
it("production rejects a missing SMTP password", () =>
  expect(() => loadConfig({ env: { ...prod, SMTP_PASSWORD: undefined }, store })).toThrow("SMTP_PASSWORD"));
```

- [ ] **Step 2: Run `pnpm --filter @platform/config test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** One Zod schema; `ConfigError.message` lists each issue as `<path>: <message>`. Write the four `.env.<profile>.example` files listing exactly the variables each profile requires, with placeholder values and no real secrets.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(config): typed config, environment profiles and production guards`

### Task 4: Database layer (`@platform/db`)

**Files:**
- Create: `packages/db/src/{client,columns,migrate,errors,testing,index}.ts`
- Create: `tools/db-generate/index.ts` (root script `db:generate <module>`)
- Test: `packages/db/test/{migrate,columns}.test.ts`, fixtures `packages/db/test/fixtures/{alpha,beta}/db/{schema.ts,migrations/}`

**Interfaces:**
- Produces:

```ts
export type Db = NodePgDatabase; export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function createDb(databaseUrl: string): { db: Db; close(): Promise<void> };
export const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
export const timestamps = { createdAt: /* created_at timestamptz not null default now() */,
                            updatedAt: /* updated_at, same, refreshed on update */ };
export const softDelete = { deletedAt: /* deleted_at timestamptz null */ };
export const version = { version: /* integer not null default 1 */ };
export const money = (name: string) => ({ /* <name>_amount bigint, <name>_currency char(3) */ });
export class ConflictError extends Error {}
export function expectUpdated<T>(rows: T[]): T; // throws ConflictError when rows is empty
export interface MigrationSource { id: string; migrationsFolder: string }
export async function runMigrations(db: Db, sources: MigrationSource[]): Promise<void>;
export async function createTestDatabase(sources: MigrationSource[]):
  Promise<{ db: Db; url: string; drop(): Promise<void> }>;
```

- `runMigrations` applies sources in the order given, each with `migrationsTable: "__migrations_" + id.replaceAll("-", "_")`.
- `db:generate <module>` runs `drizzle-kit generate --dialect postgresql --schema modules/<id>/db/schema.ts --out modules/<id>/db/migrations`.

- [ ] **Step 1: Write the failing tests.** Fixture `beta` has a foreign key to `alpha`'s table.

```ts
it("applies each module's migrations with its own tracking table", async () => {
  const t = await createTestDatabase([alpha, beta]);
  const tables = await listTables(t.db); // helper: schema.table names
  expect(tables).toEqual(expect.arrayContaining(
    ["public.alpha_items", "public.beta_notes", "drizzle.__migrations_alpha", "drizzle.__migrations_beta"]));
  await t.drop();
});
it("is safe to run twice", async () => {
  const t = await createTestDatabase([alpha]); await runMigrations(t.db, [alpha]);
  expect(await countRows(t.db, "drizzle.__migrations_alpha")).toBe(1); await t.drop();
});
it("adds a module later without touching earlier ones", async () => {
  const t = await createTestDatabase([alpha]); await runMigrations(t.db, [alpha, beta]);
  expect(await listTables(t.db)).toContain("public.beta_notes"); await t.drop();
});
it("expectUpdated throws ConflictError on an empty result", () =>
  expect(() => expectUpdated([])).toThrow(ConflictError));
it("generates time-ordered ids", () => { const a = uuidv7(), b = uuidv7(); expect(a < b).toBe(true); });
```

- [ ] **Step 2: Run `pnpm --filter @platform/db test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Generate the fixture migrations with drizzle-kit and commit them. `createTestDatabase` connects to `TEST_DATABASE_URL`, creates `test_<random>`, migrates, and `drop()` closes the pool then drops the database.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(db): client, column helpers and per-module migration runner`

### Task 5: `pnpm modules:sync`

**Files:**
- Create: `tools/modules-sync/src/{plan,run}.ts`, `store.config.ts` (empty `modules: {}` for now)
- Create (generated): `apps/api/src/modules.generated.ts`, `apps/admin/src/modules.generated.ts`
- Test: `tools/modules-sync/test/plan.test.ts`

**Interfaces:**
- Consumes: `resolveModules`, `ModuleManifest`, `StoreConfigInput`.
- Produces:

```ts
export function planSync(store: StoreConfigInput, available: Record<string, ModuleManifest>):
  { apiFile: string; adminFile: string }; // throws ModuleConfigError
// run.ts flags: (none) writes both files; --check exits 1 if either file differs
```

- Module package convention every later task follows: `@modules/<id>/manifest` exports `manifest`, `@modules/<id>/api` exports `apiModule`, `@modules/<id>/admin` exports `adminModule`.
- Generated API file exports `apiModules: { id: string; manifest: ModuleManifest; apiModule: Type }[]` in dependency order. Generated admin file exports `adminModules: AdminModuleDef[]` and `manifests: ModuleManifest[]`.
- `run.ts` discovers available modules by reading `modules/*/manifest.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it("imports only enabled modules, dependencies first", () => {
  const out = planSync({ ...store, modules: { b: {}, a: {} } }, { a, b, c });
  expect(out.apiFile).toContain('from "@modules/a/api"');
  expect(out.apiFile.indexOf("@modules/a/api")).toBeLessThan(out.apiFile.indexOf("@modules/b/api"));
  expect(out.apiFile).not.toContain("@modules/c");
  expect(out.adminFile).toContain('from "@modules/b/admin"');
});
it("starts with a do-not-edit header", () =>
  expect(planSync(store, {}).apiFile.startsWith("// GENERATED by pnpm modules:sync. Do not edit.")).toBe(true));
it("is deterministic", () => expect(planSync(s, av)).toEqual(planSync(s, av)));
it("surfaces resolver errors", () =>
  expect(() => planSync({ ...store, modules: { b: {} } }, { a, b })).toThrow('requires "a"'));
```

- [ ] **Step 2: Run `pnpm --filter modules-sync test`.** Expected: FAIL.
- [ ] **Step 3: Implement `planSync` and `run.ts`; add root scripts `modules:sync` and `modules:sync --check`.** Run `pnpm modules:sync` and commit the generated files.
- [ ] **Step 4: Run the tests, then `pnpm modules:sync --check`.** Expected: PASS, exit 0.
- [ ] **Step 5: Commit.** `feat(tools): modules:sync generator with drift check`

### Task 6: HTTP conventions (`@platform/server`)

**Files:**
- Create: `packages/server/src/http/{app-error,error-filter,validation,list-query,csv,request-context,request-id.middleware,logging}.ts`
- Create: `packages/server/src/platform.module.ts`, `packages/server/src/create-app.ts`
- Modify: `packages/server/src/health.controller.ts` (add `/ready`), `apps/api/src/main.ts`
- Test: `packages/server/test/http/{errors,list-query,csv,hardening}.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `Db`.
- Produces:

```ts
export class AppError extends Error {
  constructor(code: string, status: number, message: string, fields?: Record<string, string[]>);
}
export interface ListQuery { page: number; pageSize: number;
  sort: { field: string; dir: "asc" | "desc" }[]; filter: Record<string, string>; format: "json" | "csv" }
export function parseListQuery(raw: unknown,
  opts: { sortable: string[]; filterable: string[]; defaultSort: string }): ListQuery;
export interface Paginated<T> { data: T[]; total: number; page: number; pageSize: number }
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string;
export interface Actor { userId: string; email: string; sessionId: string }
export interface RequestContext { requestId: string; actor: Actor | null;
  ip: string | null; userAgent: string | null; auditCount: number }
export const requestContext: { get(): RequestContext | undefined; run<T>(ctx: RequestContext, fn: () => T): T };
export const CONFIG: symbol; export const DB: symbol; // injection tokens for AppConfig and Db
export interface ErrorTracker { capture(error: unknown, context: { requestId?: string }): void }
export const ERROR_TRACKER: symbol; // "none" is a no-op; "sentry" uses config.errorTracking.dsn
export async function createApp(opts: { config: AppConfig; db: Db; modules: Type[] }): Promise<INestApplication>;
```

- Error codes and statuses: `request.validation_failed` 400, `request.invalid_query` 400, `auth.unauthenticated` 401, `auth.forbidden` 403, `request.not_found` 404, `request.conflict` 409 (also for `ConflictError`), `request.too_large` 413, `request.rate_limited` 429, `server.internal` 500.
- `sort` syntax: comma-separated fields, `-` prefix for descending. `format=csv` returns `text/csv` capped at 10,000 rows.
- `createApp` applies: prefix `api/v1`, request id middleware (honours an incoming `X-Request-Id`, else UUIDv7, echoed in the response header), error filter, Zod validation, security headers, CORS limited to `config.adminUrl`, JSON body limit 1 MB, global rate limit 300 requests per minute per IP, pino logging with the request id on each line and `cookie`, `authorization`, `set-cookie` headers and any `password` field redacted. The error filter sends unexpected errors (not `AppError`s) to `ERROR_TRACKER`.
- `GET /api/v1/ready` returns 200 `{ status: "ready" }` when a `select 1` succeeds, else 503.

- [ ] **Step 1: Write the failing tests**

```ts
it("wraps AppError in the standard shape", async () => {
  const res = await http.get("/api/v1/test/boom"); // fixture route throws new AppError("x.y", 418, "Teapot")
  expect(res.status).toBe(418);
  expect(res.body).toEqual({ error: { code: "x.y", message: "Teapot", fields: {}, requestId: res.headers["x-request-id"] } });
});
it("maps validation failures to per-field messages", async () => {
  const res = await http.post("/api/v1/test/echo").send({ email: "nope" });
  expect(res.status).toBe(400); expect(res.body.error.code).toBe("request.validation_failed");
  expect(res.body.error.fields.email).toHaveLength(1);
});
it("hides internals on unexpected errors", async () => {
  const res = await http.get("/api/v1/test/crash");
  expect(res.body.error).toMatchObject({ code: "server.internal", message: "Something went wrong" });
  expect(JSON.stringify(res.body)).not.toContain("at ");
});
it("reports unexpected errors to the tracker but not AppErrors", async () => {
  await http.get("/api/v1/test/crash"); await http.get("/api/v1/test/boom");
  expect(tracker.captured).toHaveLength(1);
});
it("maps ConflictError to 409", async () => expect((await http.get("/api/v1/test/conflict")).status).toBe(409));
it("rejects a body over 1 MB with 413", async () =>
  expect((await http.post("/api/v1/test/echo").send({ email: "a@b.co", pad: "x".repeat(1_100_000) })).status).toBe(413));

const opts = { sortable: ["name", "createdAt"], filterable: ["status"], defaultSort: "-createdAt" };
it("defaults paging and sort", () =>
  expect(parseListQuery({}, opts)).toEqual({ page: 1, pageSize: 25, sort: [{ field: "createdAt", dir: "desc" }], filter: {}, format: "json" }));
it("caps pageSize at 100", () => expect(parseListQuery({ pageSize: "500" }, opts).pageSize).toBe(100));
it("rejects an unknown sort field", () => expect(() => parseListQuery({ sort: "password" }, opts)).toThrow(AppError));
it("rejects an unknown filter", () => expect(() => parseListQuery({ filter: { secret: "1" } }, opts)).toThrow(AppError));
it("rejects page 0 and non-numbers", () => {
  expect(() => parseListQuery({ page: "0" }, opts)).toThrow(AppError);
  expect(() => parseListQuery({ page: "abc" }, opts)).toThrow(AppError);
});

const cols = [{ key: "name", header: "Name" }];
it("quotes commas, quotes and newlines", () =>
  expect(toCsv([{ name: 'a,"b"\nc' }], cols)).toBe('Name\r\n"a,""b""\nc"\r\n'));
it.each(["=SUM(A1)", "+1", "-1", "@cmd"])("neutralises a formula cell %s", (v) =>
  expect(toCsv([{ name: v }], cols)).toBe(`Name\r\n'${v}\r\n`));
it("writes empty string for null and undefined", () =>
  expect(toCsv([{ name: null }], cols)).toBe("Name\r\n\r\n"));
```

- [ ] **Step 2: Run `pnpm --filter @platform/server test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** `requestContext` wraps `AsyncLocalStorage`. Test fixtures register a small `TestController` only in tests.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): error shape, validation, list queries, CSV and request context`

### Task 7: Route security (`@platform/server`)

**Files:**
- Create: `packages/server/src/security/{decorators,access.guard,csrf,tokens,route-audit}.ts`
- Test: `packages/server/test/security/{guard,csrf,route-audit}.test.ts`

**Interfaces:**
- Consumes: `Actor`, `requestContext`, `AppConfig`, `AppError`.
- Produces:

```ts
export const Public: () => MethodDecorator & ClassDecorator;
export const Authenticated: () => MethodDecorator & ClassDecorator;
export const RequirePermission: (key: string) => MethodDecorator;
export const DemoLocked: () => MethodDecorator; // 403 demo.locked when config.demo.lockRiskySettings
export interface Authenticator { authenticate(req: Request): Promise<Actor | null> }
export const AUTHENTICATOR: symbol;
export interface PermissionResolver {
  resolve(userId: string): Promise<{ permissions: string[]; roleKeys: string[] }>;
  usersWithPermission(key: string): Promise<string[]>;
}
export const PERMISSION_RESOLVER: symbol;
export class CsrfService { tokenFor(sessionId: string): string; verify(sessionId: string, token: string): boolean }
export function findUnguardedRoutes(app: INestApplication): string[]; // e.g. "POST /api/v1/admin/x"
```

- `AccessGuard` is global. `@Public`: no session needed; non-GET requests must carry an `Origin` header equal to the origin of `config.adminUrl`, else 403 `auth.csrf_invalid`. `@Authenticated` and `@RequirePermission`: `Authenticator` must return an actor (else 401 `auth.unauthenticated`), the actor is placed in the request context, and non-GET requests must carry a valid `X-CSRF-Token` (else 403 `auth.csrf_invalid`). `@RequirePermission` additionally needs the key in `resolve(userId).permissions` (else 403 `auth.forbidden`). A route with no decorator is denied with 403.
- `CsrfService.tokenFor` is HMAC-SHA256 of the session id with `config.session.secret`, hex encoded, compared in constant time.

- [ ] **Step 1: Write the failing tests** (fixture controller with one route per decorator; fake `Authenticator` and `PermissionResolver`)

```ts
it("allows a public GET without a session", async () => expect((await http.get(pub)).status).toBe(200));
it("rejects a public POST from another origin", async () =>
  expect((await http.post(pub).set("Origin", "https://evil.example")).body.error.code).toBe("auth.csrf_invalid"));
it("returns 401 without a session", async () =>
  expect((await http.get(authed)).body.error.code).toBe("auth.unauthenticated"));
it("returns 403 without the permission", async () =>
  expect((await as({ permissions: [] }).get(needsPerm)).body.error.code).toBe("auth.forbidden"));
it("allows with the permission", async () =>
  expect((await as({ permissions: ["t.thing.read"] }).get(needsPerm)).status).toBe(200));
it("rejects an authenticated POST without a CSRF token", async () =>
  expect((await as({ permissions: ["t.thing.update"] }, { csrf: false }).post(needsPermPost)).body.error.code).toBe("auth.csrf_invalid"));
it("denies an undecorated route", async () => expect((await as({ permissions: ["*"] }).get(bare)).status).toBe(403));
it("blocks @DemoLocked routes in the demo profile only", async () => {
  expect((await demoApp.as(owner).post(locked)).body.error.code).toBe("demo.locked");
  expect((await devApp.as(owner).post(locked)).status).toBe(201);
});
it("puts the actor in the request context", async () =>
  expect((await as({ userId: "u1", permissions: [] }).get(whoami)).body.userId).toBe("u1"));
it("lists undecorated routes", () => expect(findUnguardedRoutes(app)).toEqual(["GET /api/v1/test/bare"]));
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** `findUnguardedRoutes` walks controllers with Nest's discovery service and reads the decorator metadata.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): deny-by-default guard, CSRF and unguarded-route finder`

### Task 8: Mutations, audit hook, outbox events and jobs (`@platform/server`)

**Files:**
- Create: `packages/server/src/data/{mutation-runner,redact,audit-tokens,audit-enforcement.interceptor}.ts`
- Create: `packages/server/src/events/{event-bus,outbox.schema,dispatcher,on-event.decorator}.ts`
- Create: `packages/server/src/jobs/{jobs.service,inline-jobs,boss-jobs}.ts`, `packages/server/src/services/tokens.ts`
- Create: `packages/server/db/schema.ts`, `packages/server/db/migrations/` (source id `platform`)
- Test: `packages/server/test/data/{mutation-runner,redact,enforcement}.test.ts`, `packages/server/test/events/outbox.test.ts`

**Interfaces:**
- Consumes: `Db`, `Tx`, `requestContext`.
- Produces:

```ts
export interface AuditEntryInput { action: string; entityType: string; entityId: string | null;
  before: unknown; after: unknown }
export interface AuditRecorder { record(tx: Tx, entry: AuditEntryInput): Promise<void> }
export const AUDIT_RECORDER: symbol;
export interface DomainEvent<T = unknown> { name: string; payload: T }
export class MutationRunner {
  run<T>(spec: {
    action: string; entityType: string; sensitive?: string[];
    before?: (tx: Tx) => Promise<unknown | null>;
    mutate: (tx: Tx) => Promise<T>;
    after: (tx: Tx, result: T) => Promise<{ entityId: string | null; value: unknown | null }>;
    events?: (result: T) => DomainEvent[];
  }): Promise<T>;
  recordOnly(entry: AuditEntryInput): Promise<void>; // sign-in events and similar
}
export const DEFAULT_SENSITIVE = ["password", "passwordHash", "token", "tokenHash", "secret", "mfaSecret", "codeHash"];
export function redact(value: unknown, extraKeys?: string[]): unknown; // deep; replaces with "[redacted]"
export const NoAudit: (reason: string) => MethodDecorator;
export const OnEvent: (name: string) => MethodDecorator; // handler(payload, meta: { eventId: string })
export class EventBus { publish(tx: Tx, events: DomainEvent[]): Promise<void>; dispatchPending(): Promise<number> }
export abstract class JobsService {
  abstract register(name: string, handler: (data: unknown) => Promise<void>): void;
  abstract enqueue(name: string, data: unknown): Promise<void>;
  abstract schedule(name: string, cron: string): Promise<void>;
  abstract runScheduled(name: string): Promise<void>; // for tests and CLI
}
export const platformMigrations: MigrationSource; // { id: "platform", ... }

// services/tokens.ts: interfaces implemented by later modules
export interface MailMessage { to: string; subject: string; html: string; text: string }
export interface Mailer { send(msg: MailMessage): Promise<void>; enqueue(msg: MailMessage): Promise<void> }
export const MAILER: symbol;
export interface Notifier { notify(input: { userIds: string[]; title: string; body: string;
  link?: string; sourceEventId?: string }): Promise<void> }
export const NOTIFIER: symbol;
export interface StorageProvider { put(key: string, body: Buffer, contentType: string): Promise<void>;
  url(key: string): string; delete(key: string): Promise<void> }
export const STORAGE: symbol;
```

- `run` executes `before`, `mutate`, `after`, `AuditRecorder.record` and `EventBus.publish` in one transaction, redacts `before` and `after`, and increments `requestContext.auditCount`.
- Table `platform_outbox`: `id`, `name`, `payload jsonb`, `created_at`, `dispatched_at`. `dispatchPending` enqueues one `platform.events` job per undispatched row and marks it dispatched; the job invokes every `@OnEvent` handler for that name. It runs after each commit and every 5 seconds.
- `AuditEnforcementInterceptor`: when a non-GET `/admin` request succeeds with `auditCount === 0` and the handler has no `@NoAudit`, it throws `server.internal` outside production and logs an error in production.
- `JobsService` has two implementations chosen by `createApp`: pg-boss (default) and inline (tests), where `enqueue` runs the handler immediately.
- `createApp` gains `jobs?: "boss" | "inline"`.

- [ ] **Step 1: Write the failing tests** (fake `AuditRecorder` collecting entries; a fixture table)

```ts
it("records before and after in the same transaction", async () => {
  await runner.run({ action: "t.thing.update", entityType: "t.thing",
    before: () => load(id), mutate: (tx) => rename(tx, id, "new"), after: async (tx) => ({ entityId: id, value: await load(id, tx) }) });
  expect(recorder.entries[0]).toMatchObject({ action: "t.thing.update", entityId: id,
    before: { name: "old" }, after: { name: "new" } });
});
it("rolls back the change, the audit entry and the events together", async () => {
  await expect(runner.run({ ...spec, mutate: async (tx) => { await rename(tx, id, "x"); throw new Error("boom"); } })).rejects.toThrow("boom");
  expect((await load(id)).name).toBe("old"); expect(recorder.entries).toHaveLength(0);
  expect(await countRows(db, "platform_outbox")).toBe(0);
});
it("redacts default and extra sensitive keys at any depth", () =>
  expect(redact({ email: "a", passwordHash: "h", nested: { token: "t", pin: "1" } }, ["pin"]))
    .toEqual({ email: "a", passwordHash: "[redacted]", nested: { token: "[redacted]", pin: "[redacted]" } }));
it("delivers an event to its handler after commit", async () => {
  await runner.run({ ...spec, events: () => [{ name: "t.thing.renamed", payload: { id } }] });
  await bus.dispatchPending();
  expect(handler).toHaveBeenCalledWith({ id }, { eventId: expect.any(String) });
});
it("does not deliver the same row twice", async () => {
  await bus.dispatchPending(); await bus.dispatchPending(); expect(handler).toHaveBeenCalledTimes(1);
});
it("fails a mutating admin route that wrote no audit entry", async () =>
  expect((await as(owner).post("/api/v1/admin/test/silent")).status).toBe(500));
it("accepts a mutating route marked @NoAudit", async () =>
  expect((await as(owner).post("/api/v1/admin/test/exempt")).status).toBe(201));
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Generate the `platform` migration with drizzle-kit.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): mutation runner, audit enforcement, outbox events and jobs`

### Task 9: Test app, module contract suite and `pnpm create:module`

**Files:**
- Create: `packages/server/src/testing/{test-app,module-contract}.ts`
- Create: `tools/create-module/src/{scaffold,run}.ts`, `tools/create-module/templates/**`
- Test: `tools/create-module/test/scaffold.test.ts`, `packages/server/test/testing/contract.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 8.
- Produces:

```ts
export interface TestModule { id: string; manifest: ModuleManifest; apiModule: Type; migrationsFolder: string }
export interface TestActor { userId?: string; email?: string; permissions: string[]; roleKeys?: string[] }
export interface TestApp {
  app: INestApplication; db: Db; config: AppConfig;
  as(actor: TestActor | "owner", opts?: { csrf?: boolean }): SuperTestAgent; // "owner" holds every permission
  anon(): SuperTestAgent; // sends Origin: config.adminUrl
  recorder: { entries: AuditEntryInput[] }; // fake AuditRecorder unless the audit module is loaded
  mail: { sent: MailMessage[] };            // fake Mailer unless the notifications module is loaded
  flushEvents(): Promise<void>; close(): Promise<void>;
}
export function createTestApp(opts: { modules: TestModule[]; env?: AppEnv;
  store?: Partial<StoreConfigInput>; realAuth?: boolean }): Promise<TestApp>;
export function describeModuleContract(opts: { module: TestModule; dependencies: TestModule[] }): void;
export function scaffoldModule(id: string, name: string): { path: string; content: string }[];
```

- `createTestApp` creates a test database, migrates `platform` plus the given modules, uses inline jobs, and (unless `realAuth`) provides a fake `Authenticator` and `PermissionResolver` driven by `as()`.
- `describeModuleContract` registers these tests: the manifest is valid; `findUnguardedRoutes` is empty; every `@RequirePermission` key is declared in the manifest; migrations apply on a clean database; all table names start with `<id>_` (dashes as underscores); the app boots with the module; for non-core modules the app also boots without it and its routes return 404.
- The scaffold produces `manifest.ts` (one permission `<id>.item.read`, one nav item `/<id>`), `api/index.ts` with one list endpoint, `admin/index.ts` with one list page, `admin/messages/en.json`, `db/schema.ts` with table `<id>_items`, `package.json`, and `test/contract.test.ts` calling `describeModuleContract`.

- [ ] **Step 1: Write the failing tests**

```ts
it("scaffolds the expected files", () =>
  expect(scaffoldModule("example", "Example").map((f) => f.path).sort()).toEqual([
    "modules/example/admin/index.ts", "modules/example/admin/messages/en.json", "modules/example/api/index.ts",
    "modules/example/db/schema.ts", "modules/example/manifest.ts", "modules/example/package.json",
    "modules/example/test/contract.test.ts"]));
it("rejects an id that is not kebab-case", () => expect(() => scaffoldModule("My Module", "x")).toThrow("kebab-case"));
it("refuses to overwrite an existing module", async () =>
  await expect(run(["auth"])).rejects.toThrow('Module "auth" already exists'));

// contract.test.ts: scaffold "example" into a temp workspace folder, generate its migration, then
describeModuleContract({ module: exampleModule, dependencies: [] });
it("serves the example route when enabled and 404s when not", async () => {
  const on = await createTestApp({ modules: [exampleModule] });
  expect((await on.as("owner").get("/api/v1/admin/example/items")).status).toBe(200);
  const off = await createTestApp({ modules: [] });
  expect((await off.as("owner").get("/api/v1/admin/example/items")).status).toBe(404);
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** `run.ts` writes the files, runs `db:generate <id>` and prints the two lines to add to `store.config.ts`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(tools): test app, module contract suite and module scaffolder`

---

## Phase B: Core modules (API)

Every module task also creates `modules/<id>/package.json`, `manifest.ts`, `db/schema.ts`, generated `db/migrations/`, `api/index.ts` (exporting `apiModule`) and `test/contract.test.ts` calling `describeModuleContract`. All mutations go through `MutationRunner`. Run a module's tests with `pnpm --filter @modules/<id> test`.

### Task 10: `auth` module: accounts, sign-in and sessions

**Files:**
- Create: `modules/auth/api/{users.service,sessions.service,password,session-authenticator,login-throttle,auth.controller,me.controller}.ts`
- Test: `modules/auth/test/{contract,login,sessions,me}.test.ts`

**Interfaces:**
- Consumes: `MutationRunner`, `AUTHENTICATOR`, `PERMISSION_RESOLVER`, `CsrfService`, `createTestApp({ realAuth: true })`.
- Manifest: `id: "auth"`, `core: true`, no permissions, no nav, `options: z.object({ requireMfaForRoles: z.array(z.string()).default([]), passwordMinLength: z.number().int().min(8).default(12) })`.
- Tables: `auth_users` (`email` unique and stored trimmed and lower-cased, `name`, `password_hash` nullable, `status` `invited|active|disabled`, `is_seeded`, `mfa_secret` nullable, `mfa_enabled_at`, `mfa_last_step`, `failed_login_count`, `locked_until`, `last_login_at`, plus id, timestamps, version, soft delete); `auth_sessions` (`user_id`, `token_hash`, `mfa_verified`, `mfa_failures`, `ip`, `user_agent`, `last_seen_at`, `expires_at`, `revoked_at`).
- Produces:

```ts
export interface StaffUser { id: string; email: string; name: string; status: "invited" | "active" | "disabled";
  mfaEnabled: boolean; isSeeded: boolean; lastLoginAt: Date | null; createdAt: Date; version: number }
export function normalizeEmail(raw: string): string; // trim + lower-case
export class AuthUsersService {
  findById(id: string): Promise<StaffUser | null>;
  findByEmail(email: string): Promise<StaffUser | null>;
  list(q: ListQuery): Promise<Paginated<StaffUser>>; // sortable: name, email, createdAt, lastLoginAt; filters: status, q (name or email contains)
  createActive(tx: Tx, input: { email: string; name: string; password: string; isSeeded?: boolean }): Promise<StaffUser>;
  setStatus(tx: Tx, userId: string, status: "active" | "disabled", version: number): Promise<StaffUser>;
  countSeeded(): Promise<number>;
}
export class SessionsService {
  create(userId: string, meta: { ip: string | null; userAgent: string | null; mfaVerified: boolean }): Promise<{ token: string }>;
  revokeAllForUser(tx: Tx, userId: string, exceptSessionId?: string): Promise<void>;
}
```

- Routes under `/api/v1/admin`:

| Route | Access | Behaviour |
|---|---|---|
| `POST /auth/login` `{ email, password }` | Public | 200 `{ status: "ok" \| "mfa_required" }` and sets cookie `sid`. Any failure: 401 `auth.invalid_credentials` |
| `POST /auth/logout` | Authenticated | Revokes the session, clears the cookie, 204 |
| `GET /auth/session` | Authenticated | `{ user: { id, email, name, version }, permissions, roleKeys, csrfToken, mfaEnabled, mfaEnrollmentRequired }` |
| `GET /me/sessions` | Authenticated | Own sessions, `current: true` on this one |
| `DELETE /me/sessions/:id` | Authenticated | 204; another user's id returns 404 |
| `POST /me/password` `{ currentPassword, newPassword }` | Authenticated, DemoLocked | Revokes other sessions |
| `PATCH /me` `{ name, version }` | Authenticated | |

- Fixed values: argon2id hashing. Cookie `sid` is httpOnly, `SameSite=Lax`, `Secure` when `adminUrl` is https, path `/`. The cookie holds 32 random bytes (base64url); the table stores its SHA-256. Idle timeout 12 hours (refresh `last_seen_at` at most once a minute), absolute lifetime 7 days. Five consecutive failures lock the account for 15 minutes; a locked account returns the same `auth.invalid_credentials`. Login is limited to 10 attempts per minute per IP (429 `request.rate_limited`). Passwords: minimum `passwordMinLength`, maximum 128.
- `SessionAuthenticator` returns an actor only for an unexpired, unrevoked session of an `active` user whose MFA, if enabled, is verified.
- Audit actions via `recordOnly`: `auth.session.login`, `auth.session.login_failed` (entity id is the user id when known, never the password), `auth.session.logout`. Via `run`: `auth.session.revoke`, `auth.user.password_change`, `auth.user.update`.

- [ ] **Step 1: Write the failing tests**

```ts
it("signs in and exposes the session", async () => {
  const agent = t.anon(); const res = await agent.post(login).send({ email: "owner@example.com", password: pw });
  expect(res.body).toEqual({ status: "ok" });
  expect(res.headers["set-cookie"][0]).toMatch(/^sid=.+HttpOnly.+SameSite=Lax/);
  expect((await agent.get(session)).body.user.email).toBe("owner@example.com");
});
it("treats email case and surrounding spaces as the same account", async () => {
  expect((await t.anon().post(login).send({ email: "  Owner@Example.COM ", password: pw })).status).toBe(200);
  await expect(createUser({ email: "OWNER@example.com" })).rejects.toThrow(); // unique after normalising
});
it.each([["wrong password", { email: "owner@example.com", password: "nope-nope-nope" }],
         ["unknown email", { email: "ghost@example.com", password: pw }],
         ["disabled account", { email: "disabled@example.com", password: pw }]])(
  "gives the same error for %s", async (_n, body) => {
    const res = await t.anon().post(login).send(body);
    expect(res.status).toBe(401); expect(res.body.error.code).toBe("auth.invalid_credentials");
  });
it("locks for 15 minutes after 5 failures, then recovers", async () => {
  for (let i = 0; i < 5; i++) await t.anon().post(login).send({ email, password: "bad-bad-bad-bad" });
  expect((await t.anon().post(login).send({ email, password: pw })).status).toBe(401);
  clock.advance(15 * 60_000 + 1);
  expect((await t.anon().post(login).send({ email, password: pw })).status).toBe(200);
});
it("expires an idle session after 12 hours", async () => {
  clock.advance(12 * 3600_000 + 1); expect((await agent.get(session)).status).toBe(401);
});
it("stores only a hash of the session token", async () =>
  expect(JSON.stringify(await allRows(t.db, "auth_sessions"))).not.toContain(cookieValue(agent)));
it("revokes other sessions on password change", async () => {
  await a1.post(mePassword).send({ currentPassword: pw, newPassword: "a-new-long-password" });
  expect((await a2.get(session)).status).toBe(401); expect((await a1.get(session)).status).toBe(200);
});
it("cannot revoke another user's session", async () =>
  expect((await a1.delete(`/api/v1/admin/me/sessions/${otherSessionId}`)).status).toBe(404));
it("audits a failed login without the password", async () => {
  await t.anon().post(login).send({ email, password: "super-secret-wrong" });
  const e = t.recorder.entries.at(-1); expect(e.action).toBe("auth.session.login_failed");
  expect(JSON.stringify(e)).not.toContain("super-secret-wrong");
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Inject a clock so tests can advance time.
- [ ] **Step 4: Run the tests.** Expected: PASS, including the contract suite.
- [ ] **Step 5: Commit.** `feat(auth): staff accounts, sign-in, lockout and sessions`

### Task 11: `auth` module: invites and password reset

**Files:**
- Create: `modules/auth/api/{tokens.service,invites.controller,password-reset.controller,auth-mail.service,emails}.ts`
- Modify: `modules/auth/db/schema.ts` (table `auth_tokens`), `modules/auth/api/users.service.ts`
- Test: `modules/auth/test/{invites,password-reset}.test.ts`

**Interfaces:**
- Consumes: `MAILER` (Task 8), `AuthUsersService`, `SessionsService`.
- Table `auth_tokens`: `user_id`, `kind` `invite|password_reset`, `token_hash`, `expires_at`, `used_at`.
- Produces:

```ts
// added to AuthUsersService
createInvited(tx: Tx, input: { email: string; name: string }): Promise<{ user: StaffUser; token: string }>;
reissueInvite(tx: Tx, userId: string): Promise<{ user: StaffUser; token: string }>; // voids earlier invite tokens
export class AuthMailService {
  sendInvite(user: StaffUser, token: string): Promise<void>;        // link: <adminUrl>/accept-invite?token=<token>
  sendPasswordReset(user: StaffUser, token: string): Promise<void>; // link: <adminUrl>/reset-password?token=<token>
}
```

- Routes (all Public):

| Route | Behaviour |
|---|---|
| `POST /auth/invite/check` `{ token }` | 200 `{ email, name }` |
| `POST /auth/invite/accept` `{ token, name, password }` | Activates the user, marks the token used, signs in, emits `auth.user.invite_accepted` `{ userId, email, name }` |
| `POST /auth/password/forgot` `{ email }` | Always 204. Sends a reset email only to an `active` user. Limited to 5 per hour per IP |
| `POST /auth/password/reset` `{ token, password }` | Sets the password, marks the token used, revokes every session of that user |

- Invite tokens last 72 hours, reset tokens 1 hour. Any unknown, expired, used or malformed token returns 400 `auth.token_invalid` with message `This link is no longer valid. Ask for a new one.`
- Token emails use `Mailer.send` (direct, never queued) so the raw token is not persisted in a job table.
- Audit actions: `auth.user.invite_accept`, `auth.user.password_reset_request`, `auth.user.password_reset`.

- [ ] **Step 1: Write the failing tests**

```ts
it("accepts an invite, signs in and emits the event", async () => {
  const { token } = await invite("new@example.com"); const agent = t.anon();
  expect((await agent.post(accept).send({ token, name: "New Person", password: "a-long-password-1" })).status).toBe(200);
  expect((await agent.get(session)).body.user.email).toBe("new@example.com");
  expect(await outboxNames(t.db)).toContain("auth.user.invite_accepted");
});
it.each([["used", () => usedToken], ["expired (72h + 1ms)", () => expiredToken],
         ["garbage", () => "not-a-token"], ["empty", () => ""], ["reissued-over", () => supersededToken]])(
  "rejects a %s invite token with a clear message", async (_n, get) => {
    const res = await t.anon().post(accept).send({ token: get(), name: "X", password: "a-long-password-1" });
    expect(res.status).toBe(400); expect(res.body.error.code).toBe("auth.token_invalid");
    expect(res.body.error.message).toBe("This link is no longer valid. Ask for a new one.");
  });
it("answers 204 for unknown and known emails alike and mails only the known one", async () => {
  expect((await t.anon().post(forgot).send({ email: "ghost@example.com" })).status).toBe(204);
  expect((await t.anon().post(forgot).send({ email: "owner@example.com" })).status).toBe(204);
  expect(t.mail.sent.map((m) => m.to)).toEqual(["owner@example.com"]);
});
it("resets the password, kills old sessions and burns the token", async () => {
  const token = tokenFrom(t.mail.sent[0]);
  expect((await t.anon().post(reset).send({ token, password: "brand-new-password-9" })).status).toBe(204);
  expect((await oldAgent.get(session)).status).toBe(401);
  expect((await t.anon().post(reset).send({ token, password: "another-password-10" })).body.error.code).toBe("auth.token_invalid");
});
it("rejects a reset token after 1 hour", async () => { clock.advance(3600_000 + 1); /* expect auth.token_invalid */ });
it("rejects a password shorter than 12 with a field error", async () =>
  expect((await t.anon().post(accept).send({ token, name: "X", password: "short" })).body.error.fields.password).toBeDefined());
it("stores only token hashes", async () =>
  expect(JSON.stringify(await allRows(t.db, "auth_tokens"))).not.toContain(token));
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Regenerate the auth migration (`pnpm db:generate auth`).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(auth): staff invites and password reset`

### Task 12: `auth` module: MFA

**Files:**
- Create: `modules/auth/api/{mfa.service,mfa.controller,encryption,mfa-enrollment.guard}.ts`
- Modify: `modules/auth/db/schema.ts` (table `auth_recovery_codes`: `user_id`, `code_hash`, `used_at`)
- Test: `modules/auth/test/mfa.test.ts`

**Interfaces:**
- Consumes: `config.encryptionKey`, `PERMISSION_RESOLVER`, module option `requireMfaForRoles`.
- Produces: `encrypt(plain: string): string` and `decrypt(sealed: string): string` (AES-256-GCM, random IV, output `iv.tag.ciphertext` base64url).
- Routes:

| Route | Access | Behaviour |
|---|---|---|
| `POST /me/mfa/enroll` | Authenticated, DemoLocked | `{ secret, otpauthUrl }`; stores the encrypted secret, not yet enabled |
| `POST /me/mfa/confirm` `{ code }` | Authenticated | Enables MFA, returns `{ recoveryCodes }` (10 codes, shown once) |
| `POST /me/mfa/disable` `{ password }` | Authenticated, DemoLocked | |
| `POST /auth/mfa/verify` `{ code }` or `{ recoveryCode }` | Public (reads the `sid` cookie) | Marks the session verified. Wrong code: 401 `auth.mfa_invalid` |

- TOTP: 30-second step, 6 digits, accept the current step and one either side. A step already used is rejected (`mfa_last_step`). Five wrong codes revoke the session. A recovery code works once.
- `MfaEnrollmentGuard`: when the actor's `roleKeys` intersect `requireMfaForRoles` and MFA is not enabled, every route except those under `/admin/auth` and `/admin/me` returns 403 `auth.mfa_enrollment_required`, and `GET /auth/session` reports `mfaEnrollmentRequired: true`.
- Audit actions: `auth.mfa.enable`, `auth.mfa.disable`, `auth.mfa.recovery_code_use`.

- [ ] **Step 1: Write the failing tests**

```ts
it("round-trips encryption and produces different ciphertext each time", () => {
  expect(decrypt(encrypt("s3cret"))).toBe("s3cret"); expect(encrypt("x")).not.toBe(encrypt("x"));
});
it("does not store the secret in plain text", async () => {
  const { secret } = (await agent.post(enroll)).body;
  expect(JSON.stringify(await allRows(t.db, "auth_users"))).not.toContain(secret);
});
it("requires a code at login once enabled", async () => {
  const a = t.anon(); expect((await a.post(login).send(creds)).body.status).toBe("mfa_required");
  expect((await a.get(session)).status).toBe(401);
  expect((await a.post(verify).send({ code: totp(secret) })).status).toBe(200);
  expect((await a.get(session)).status).toBe(200);
});
it("rejects a replayed code in the same step", async () => { /* second verify with same code → auth.mfa_invalid */ });
it("revokes the session after 5 wrong codes", async () => { /* 5× wrong, then correct → 401 */ });
it("accepts a recovery code once", async () => { /* first 200, second auth.mfa_invalid */ });
it("blocks other routes until a required role enrols", async () => {
  // app built with modules.auth.requireMfaForRoles = ["owner"], actor roleKeys ["owner"], MFA off
  expect((await agent.get("/api/v1/admin/me/sessions")).status).toBe(200);
  expect((await agent.get(someOtherAdminRoute)).body.error.code).toBe("auth.mfa_enrollment_required");
});
it("is locked in demo", async () => expect((await demoAgent.post(enroll)).body.error.code).toBe("demo.locked"));
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** with `otplib`. Regenerate the auth migration.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(auth): TOTP MFA with recovery codes and role enforcement`

### Task 13: `access` module: roles and staff

**Files:**
- Create: `modules/access/api/{roles.service,permission-resolver,default-roles,roles.controller,staff.controller,access.service}.ts`
- Test: `modules/access/test/{contract,roles,resolver,staff}.test.ts`

**Interfaces:**
- Consumes: `AuthUsersService`, `AuthMailService`, `SessionsService`, `ModuleRegistry`, `MutationRunner`.
- Manifest: `id: "access"`, `core: true`, `dependsOn: ["auth"]`. Permissions: `access.staff.read`, `access.staff.invite`, `access.staff.update`, `access.role.read`, `access.role.create`, `access.role.update`, `access.role.delete`. Nav: `/staff` (icon `users`, order 80, `access.staff.read`), `/roles` (icon `shield`, order 81, `access.role.read`).
- Tables: `access_roles` (`key` unique, `name`, `description`, `permissions text[]`, `is_system`, plus id, timestamps, version, soft delete); `access_user_roles` (`user_id` → `auth_users`, `role_id` → `access_roles`, composite primary key).
- Produces: the `PERMISSION_RESOLVER` provider, and

```ts
export class AccessService {
  ensureDefaultRoles(): Promise<void>; // runs at module init; creates roles only when none exist
  assignRoleByKey(tx: Tx, userId: string, roleKey: string): Promise<void>;
}
```

- Default roles: `owner` (`is_system`, permissions `["*"]`), `admin` (every registered key), `manager` (every key ending `.read` plus `access.staff.invite`), `viewer` (every key ending `.read`).
- Resolver: a user with `owner` gets every registered key. Otherwise the union of their roles' keys, keeping only keys present in the registry. Disabled users resolve to nothing.
- Routes under `/api/v1/admin`:

| Route | Permission | Notes |
|---|---|---|
| `GET /permissions` | `access.role.read` | `[{ moduleId, moduleName, permissions }]` for enabled modules |
| `GET /roles`, `GET /roles/:id` | `access.role.read` | Includes `memberCount` |
| `POST /roles` `{ name, description, permissions }` | `access.role.create` | `key` is a slug of `name`; unknown permission key: 400 field error |
| `PATCH /roles/:id` `{ name?, description?, permissions?, version }` | `access.role.update` | `owner`: 403 `access.role.system_locked` |
| `DELETE /roles/:id` | `access.role.delete` | `owner`: 403 `access.role.system_locked`. Has members: 409 `access.role.in_use` |
| `GET /staff` | `access.staff.read` | Each row includes `roles: [{ id, name }]`; supports `format=csv` |
| `POST /staff/invite` `{ email, name, roleIds }` | `access.staff.invite` | 201. Existing email: 409 `access.staff.email_taken`. Sends the invite email after commit |
| `POST /staff/:id/resend-invite` | `access.staff.invite` | Only for `invited` users, else 409 `access.staff.not_invited` |
| `PUT /staff/:id/roles` `{ roleIds }` | `access.staff.update` | |
| `PATCH /staff/:id` `{ status, version }` | `access.staff.update`, DemoLocked | Disabling revokes that user's sessions. Yourself: 409 `access.staff.self` |

- Escalation rule: nobody can grant a role, or add a permission to a role, containing a permission they do not hold: 403 `access.role.escalation`.
- Last-owner rule: any change that would leave no `active` user with the `owner` role returns 409 `access.owner.last`.
- Audit actions: `access.role.create|update|delete`, `access.staff.invite`, `access.staff.roles_update`, `access.staff.status_update`.

- [ ] **Step 1: Write the failing tests**

```ts
it("seeds four default roles once", async () => {
  expect((await roles()).map((r) => r.key).sort()).toEqual(["admin", "manager", "owner", "viewer"]);
  await access.ensureDefaultRoles(); expect(await roles()).toHaveLength(4);
});
it("gives owner every registered key", async () =>
  expect((await resolver.resolve(ownerId)).permissions.sort()).toEqual(registry.permissionKeys().sort()));
it("unions permissions across roles", async () => { /* two roles → union */ });
it("ignores stored keys of a module that is no longer enabled, and restores them when it returns", async () => {
  await setRolePermissions(roleId, ["access.staff.read", "reviews.review.read"]);
  expect((await resolver.resolve(userId)).permissions).toEqual(["access.staff.read"]);
  const withReviews = await createTestApp({ modules: [...mods, reviewsFixture] }); // same database
  expect((await resolverOf(withReviews).resolve(userId)).permissions).toContain("reviews.review.read");
});
it("resolves nothing for a disabled user", async () => expect((await resolver.resolve(disabledId)).permissions).toEqual([]));
it("rejects an unknown permission key when saving a role", async () =>
  expect((await owner.post(rolesUrl).send({ name: "X", description: "", permissions: ["nope.x.y"] })).body.error.fields.permissions).toBeDefined());
it("keeps the owner role locked", async () => {
  expect((await owner.patch(roleUrl(ownerRoleId)).send({ name: "Boss", version: 1 })).body.error.code).toBe("access.role.system_locked");
  expect((await owner.delete(roleUrl(ownerRoleId))).body.error.code).toBe("access.role.system_locked");
});
it("refuses to delete a role that has members", async () =>
  expect((await owner.delete(roleUrl(usedRoleId))).body.error.code).toBe("access.role.in_use"));
it("returns 409 for a stale role version", async () =>
  expect((await owner.patch(roleUrl(id)).send({ name: "B", version: 0 })).status).toBe(409));
it("invites staff with roles and sends one email", async () => {
  const res = await owner.post(inviteUrl).send({ email: "New@Example.com", name: "New", roleIds: [viewerRoleId] });
  expect(res.status).toBe(201); expect(res.body.email).toBe("new@example.com");
  expect(t.mail.sent).toHaveLength(1);
  expect(t.recorder.entries.at(-1).action).toBe("access.staff.invite");
});
it("refuses a duplicate invite", async () =>
  expect((await owner.post(inviteUrl).send(sameEmail)).body.error.code).toBe("access.staff.email_taken"));
it("blocks granting a role you could not hold yourself", async () =>
  expect((await manager.post(inviteUrl).send({ email: "x@example.com", name: "X", roleIds: [adminRoleId] })).body.error.code).toBe("access.role.escalation"));
it("blocks adding a permission you do not hold to a role", async () => { /* access.role.escalation */ });
it("protects the last owner", async () => {
  expect((await owner.put(staffRolesUrl(ownerId)).send({ roleIds: [viewerRoleId] })).body.error.code).toBe("access.owner.last");
  expect((await otherAdmin.patch(staffUrl(ownerId)).send({ status: "disabled", version: 1 })).body.error.code).toBe("access.owner.last");
});
it("stops you disabling yourself", async () => { /* access.staff.self */ });
it("revokes sessions when a user is disabled", async () => { /* their agent gets 401 */ });
it("exports staff as CSV", async () =>
  expect((await owner.get(`${staffListUrl}?format=csv`)).headers["content-type"]).toContain("text/csv"));
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(access): roles, permission resolver and staff management`

### Task 14: `audit` module

**Files:**
- Create: `modules/audit/api/{audit-recorder,audit.controller,retention.job}.ts`
- Test: `modules/audit/test/{contract,recorder,viewer,retention}.test.ts`

**Interfaces:**
- Consumes: `AUDIT_RECORDER`, `requestContext`, `JobsService`.
- Manifest: `id: "audit"`, `core: true`. Permission `audit.entry.read`. Nav `/audit` (icon `history`, order 90). Options `z.object({ retentionDays: z.number().int().min(1).default(365) })`.
- Table `audit_entries`: `id`, `occurred_at`, `actor_id` (plain uuid, no foreign key), `actor_email`, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `ip`, `user_agent`, `request_id`. Indexes on `occurred_at`, `actor_id`, `(entity_type, entity_id)`. The migration adds a trigger that raises on `UPDATE`.
- Produces: the `AUDIT_RECORDER` provider, filling actor, IP, user agent and request id from the request context (actor is null for CLI and jobs).
- Routes: `GET /audit/entries` (filters `actorId`, `action`, `entityType`, `entityId`, `from`, `to`; sortable `occurredAt`; default `-occurredAt`; supports `format=csv`) and `GET /audit/entries/:id`. Both need `audit.entry.read`. No write routes exist.
- Job `audit.retention`, cron `0 3 * * *`, deletes entries older than `retentionDays`.

- [ ] **Step 1: Write the failing tests**

```ts
it("stores the actor, ip, user agent and request id from the request", async () => {
  await owner.post(fixtureMutationUrl).set("User-Agent", "vitest").set("X-Request-Id", "req-1");
  expect((await allRows(t.db, "audit_entries"))[0]).toMatchObject(
    { actor_email: "owner@example.com", user_agent: "vitest", request_id: "req-1" });
});
it("records a null actor outside a request", async () => { /* runner.recordOnly from a job → actor_id null */ });
it("refuses updates at the database level", async () =>
  await expect(t.db.execute(sql`update audit_entries set action = 'x'`)).rejects.toThrow());
it("exposes no write routes", async () => {
  expect((await owner.delete(`/api/v1/admin/audit/entries/${id}`)).status).toBe(404);
  expect((await owner.patch(`/api/v1/admin/audit/entries/${id}`)).status).toBe(404);
});
it("filters by actor, action, entity and date range", async () => { /* one assertion per filter */ });
it("returns 403 without audit.entry.read", async () => expect((await viewerless.get(entriesUrl)).status).toBe(403));
it("deletes only entries older than the retention period", async () => {
  await insertEntry({ occurredAt: daysAgo(366) }); await insertEntry({ occurredAt: daysAgo(364) });
  await jobs.runScheduled("audit.retention"); expect(await countRows(t.db, "audit_entries")).toBe(1);
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(audit): append-only audit log, viewer API and retention job`

### Task 15: `settings` module, storage providers and public config

**Files:**
- Create: `packages/server/src/storage/{local,s3,files.controller}.ts`
- Create: `modules/settings/api/{settings.service,switch.service,settings.controller,logo.controller,public-config.controller,saved-views.controller}.ts`
- Test: `packages/server/test/storage/local.test.ts`, `modules/settings/test/{contract,settings,switches,logo,public-config,saved-views}.test.ts`

**Interfaces:**
- Consumes: `STORAGE` (Task 8), `ModuleRegistry`, `AppConfig`, `MutationRunner`.
- Manifest: `id: "settings"`, `core: true`, `dependsOn: ["auth"]`. Permissions `settings.value.read`, `settings.value.update`, `settings.switch.update`. Nav `/settings` (icon `settings`, order 95, `settings.value.read`). Own settings schema: `storeName` (1 to 80 chars), `supportEmail` (optional email), `primaryColor` (`#rrggbb`), `logoKey` (nullable), `timezone`, `currency` (3 letters), `defaultLocale`; defaults come from `config.branding` and `config.locale`.
- Tables: `settings_values` (`module_id` primary key, `value jsonb`, `version`, timestamps); `settings_switches` (`module_id`, `key`, `enabled`, composite key); `settings_saved_views` (`id`, `user_id` → `auth_users`, `table_id`, `name`, `state jsonb`, timestamps).
- Produces:

```ts
export class SettingsService { get<T>(moduleId: string): Promise<T> } // stored value merged over schema defaults
export class SwitchService { isEnabled(moduleId: string, key: string): Promise<boolean> } // falls back to the manifest default
export interface PublicConfig { env: AppEnv; storeName: string; primaryColor: string; logoUrl: string | null;
  defaultLocale: string; timezone: string; modules: string[]; features: string[] }
```

- `features` contains `"email-capture"` when `config.email.provider === "capture"` and `"demo-login"` when `config.demo.oneClickLogin`.
- Routes:

| Route | Access | Notes |
|---|---|---|
| `GET /api/v1/public/config` | Public | `PublicConfig` |
| `GET /api/v1/public/files/*` | Public | Local storage only; serves with the stored content type |
| `GET /admin/settings/modules` | `settings.value.read` | `[{ id, name, core, hasSettings, switches: [{ key, label, enabled }] }]`, enabled modules only |
| `GET /admin/settings/:moduleId` | `settings.value.read` | `{ value, version, schema }` where `schema` is JSON Schema. Not enabled or no settings: 404 `settings.module_not_found` |
| `PUT /admin/settings/:moduleId` `{ value, version }` | `settings.value.update`, DemoLocked | Validated against the module's schema |
| `PUT /admin/settings/:moduleId/switches/:key` `{ enabled }` | `settings.switch.update`, DemoLocked | Undeclared key: 404 |
| `POST /admin/settings/logo` (multipart `file`) | `settings.value.update`, DemoLocked | PNG, JPEG or WebP checked by file signature, at most 1 MB. Wrong type: 400 `settings.logo.invalid_type` |
| `GET /admin/saved-views?tableId=`, `POST /admin/saved-views`, `DELETE /admin/saved-views/:id` | Authenticated, `@NoAudit("personal preference")` | Own views only; another user's id returns 404 |

- Storage keys are generated server-side (`branding/logo-<uuid>.<ext>`); the uploaded filename is never used in a path.
- Audit actions: `settings.value.update`, `settings.switch.update`.

- [ ] **Step 1: Write the failing tests**

```ts
it("local storage refuses keys that escape its directory", async () => {
  await expect(local.put("../evil.txt", Buffer.from("x"), "text/plain")).rejects.toThrow();
  expect((await t.anon().get("/api/v1/public/files/..%2F..%2Fetc%2Fpasswd")).status).toBe(404);
});
it("returns schema defaults before anything is saved", async () =>
  expect((await owner.get(url("settings"))).body.value).toMatchObject({ storeName: "Acme", primaryColor: "#2563eb", currency: "USD" }));
it("saves valid settings and bumps the version", async () => { /* PUT → version 2, audit action settings.value.update */ });
it("rejects invalid settings with field errors", async () =>
  expect((await owner.put(url("settings")).send({ value: { ...v, primaryColor: "blue" }, version: 1 })).body.error.fields.primaryColor).toBeDefined());
it("returns 409 on a stale version", async () => { /* version 0 → 409 */ });
it("404s for a module that is not enabled, even if a row for it exists", async () => {
  await insertSettingsRow("reviews", {}); expect((await owner.get(url("reviews"))).body.error.code).toBe("settings.module_not_found");
  expect((await owner.get(modulesUrl)).body.map((m) => m.id)).not.toContain("reviews");
});
it("uses the manifest default for a switch until it is set", async () => { /* default true → set false → false */ });
it("rejects a logo whose bytes are not an image, whatever its name", async () =>
  expect((await owner.post(logoUrl).attach("file", Buffer.from("<svg onload=alert(1)>"), "logo.png")).body.error.code).toBe("settings.logo.invalid_type"));
it("rejects a logo over 1 MB", async () => expect((await owner.post(logoUrl).attach("file", bigPng, "l.png")).status).toBe(413));
it("serves public config without a session and reflects saved branding", async () => {
  const body = (await t.anon().get("/api/v1/public/config")).body;
  expect(body).toMatchObject({ env: "development", storeName: "Renamed", features: [] });
  expect(Object.keys(body).sort()).toEqual(["defaultLocale", "env", "features", "logoUrl", "modules", "primaryColor", "storeName", "timezone"]);
});
it("lists demo features in the demo profile", async () =>
  expect((await demo.anon().get("/api/v1/public/config")).body.features.sort()).toEqual(["demo-login", "email-capture"]));
it("locks settings changes in demo", async () => { /* demo.locked */ });
it("keeps saved views private to their owner", async () => { /* other user's DELETE → 404 */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** `createApp` provides `STORAGE` from `config.storage`. Use Zod's JSON Schema conversion for the `schema` field.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(settings): module settings, switches, branding, storage and public config`

### Task 16: `notifications` module

**Files:**
- Create: `modules/notifications/api/{mailer,providers/capture,providers/smtp,notifier,notifications.controller,demo-inbox.controller,invite-accepted.handler}.ts`
- Test: `modules/notifications/test/{contract,mailer,notifications,demo-inbox,handler}.test.ts`

**Interfaces:**
- Consumes: `MAILER`, `NOTIFIER` (Task 8), `PERMISSION_RESOLVER`, `JobsService`, `OnEvent`.
- Manifest: `id: "notifications"`, `core: true`, `dependsOn: ["auth"]`. Permission `notifications.demo-inbox.read`. Nav `/demo-inbox` (icon `inbox`, order 99, `feature: "email-capture"`).
- Tables: `notifications_items` (`id`, `user_id` → `auth_users`, `title`, `body`, `link`, `source_event_id` nullable, `read_at`, `created_at`; unique `(user_id, source_event_id)`); `notifications_captured_emails` (`id`, `to`, `subject`, `html`, `text`, `created_at`).
- Produces: the `MAILER` and `NOTIFIER` providers. `Mailer.send` delivers immediately through the configured provider; `Mailer.enqueue` adds a `notifications.email.send` job. `capture` writes to `notifications_captured_emails`; `mailpit` and `smtp` use nodemailer with `config.email.smtp`.
- Routes under `/api/v1/admin`:

| Route | Access |
|---|---|
| `GET /notifications` (filter `unread`), `GET /notifications/unread-count` → `{ count }` | Authenticated |
| `POST /notifications/:id/read`, `POST /notifications/read-all` | Authenticated, `@NoAudit("personal state")` |
| `GET /demo-inbox`, `GET /demo-inbox/:id` | `notifications.demo-inbox.read`; 404 `notifications.inbox_unavailable` unless the provider is `capture` |

- Handler for `auth.user.invite_accepted`: notify every user holding `access.staff.read` with title `New staff member`, body `<name> accepted their invitation`, link `/staff`.

- [ ] **Step 1: Write the failing tests**

```ts
it("captures email in the demo profile", async () => {
  await mailer.send({ to: "a@example.com", subject: "Hi", html: "<p>x</p>", text: "x" });
  expect((await demoOwner.get(inboxUrl)).body.data[0]).toMatchObject({ to: "a@example.com", subject: "Hi" });
});
it("hides the demo inbox when email is not captured", async () =>
  expect((await devOwner.get(inboxUrl)).body.error.code).toBe("notifications.inbox_unavailable"));
it("sends queued mail through the job", async () => { /* enqueue → captured row exists */ });
it("shows a user only their own notifications", async () => { /* u2 cannot read or mark u1's: 404 */ });
it("counts and clears unread", async () => { /* count 2 → read-all → count 0 */ });
it("notifies staff viewers when an invite is accepted, once per event", async () => {
  await handler.handle({ userId, email, name: "New Person" }, { eventId: "e1" });
  await handler.handle({ userId, email, name: "New Person" }, { eventId: "e1" });
  expect(await itemsFor(ownerId)).toEqual([expect.objectContaining(
    { title: "New staff member", body: "New Person accepted their invitation", link: "/staff" })]);
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(notifications): mail providers, in-app notifications and demo inbox`

### Task 17: API assembly, CLI commands, demo mode and API client

**Files:**
- Modify: `store.config.ts` (enable `auth`, `access`, `audit`, `settings`, `notifications`), regenerate `apps/api/src/modules.generated.ts`
- Modify: `apps/api/src/main.ts`, `packages/db/src/migrate.ts` (add `pendingMigrations`), `packages/server/src/health.controller.ts`
- Create: `apps/api/src/{bootstrap,migrations-path,openapi}.ts`, `apps/api/src/cli/{migrate,owner-create,seed,purge}.ts`
- Create: `apps/api/src/demo/{seed.service,reset.service}.ts`, `modules/auth/api/demo.controller.ts`
- Create: `tools/dev/dev.ts`, `tools/api-client/generate.ts`, `packages/api-client/{openapi.json,src/schema.d.ts,src/index.ts}`
- Test: `apps/api/test/{boot,flow,cli,demo,openapi}.test.ts`

**Interfaces:**
- Produces:

```ts
export function pendingMigrations(db: Db, sources: MigrationSource[]): Promise<string[]>; // module ids with unapplied files
export function migrationsFolderFor(id: string): string; // dist/migrations/<id> when present, else the workspace folder
export async function bootstrap(opts?: { env?: Record<string, string | undefined> }): Promise<INestApplication>;
export class SeedService { run(profile: "demo" | "development"): Promise<void> }
export class ResetService { reset(): Promise<void> }
```

- Root scripts: `db:migrate`, `owner:create`, `seed`, `modules:purge`, `api:client`, `dev`.
- `GET /ready` now also returns 503 when `pendingMigrations` is non-empty.
- `bootstrap` in production throws `Seeded accounts exist. Remove them before running in production.` when `AuthUsersService.countSeeded() > 0`.
- `owner:create` takes `--email`, `--name` and reads the password from a prompt or stdin; it creates an active user with the `owner` role. This replaces the spec's `pnpm setup`, which pnpm reserves for itself.
- `seed --profile <demo|development>` creates `owner@demo.local`, `admin@demo.local`, `manager@demo.local` and `viewer@demo.local` (names `Demo Owner` and so on, `is_seeded: true`, one role each). Development password is `ChangeMe-Dev-12345`; demo passwords are random. It is idempotent and throws `Seeding is disabled in production` when `env` is production.
- `modules:purge <id>` throws `Module "<id>" is enabled. Remove it from store.config.ts first.` for an enabled module; otherwise, after the id is typed back (or `--yes`), it drops every table named `<id>_*` and `drizzle.__migrations_<id>`.
- Demo routes in `auth` (both Public, both 404 unless `config.demo.oneClickLogin`): `GET /auth/demo-accounts` → `[{ email, name }]` of seeded users; `POST /auth/demo-login` `{ email }` → signs in that seeded user.
- Job `demo.reset`, scheduled with `config.demo.resetCron` when it is not null: truncates every table of the enabled modules and `platform_outbox`, then runs `ensureDefaultRoles` and `SeedService.run("demo")`. `ResetService.reset` throws unless `config.demo.resetCron` is set.
- `api:client` writes the OpenAPI document and runs `openapi-typescript`; `api:client --check` exits 1 on drift. Swagger UI is served at `/api/v1/docs` when `config.apiDocs`.
- `pnpm dev`: copies `.env.development.example` to `.env` if missing, starts `docker-compose.dev.yml` unless `DATABASE_URL` already accepts connections, runs `db:migrate`, then starts the API (and, after Task 19, the admin) in watch mode.

- [ ] **Step 1: Write the failing tests**

```ts
it("boots with the five core modules and has no unguarded route", async () =>
  expect(findUnguardedRoutes(await bootstrap({ env: devEnv }))).toEqual([]));
it("reports not ready while migrations are pending", async () => { /* fresh db → 503; after migrate → 200 */ });
it("runs the full staff flow", async () => {
  // owner signs in → invites viewer@x with the viewer role → link read from the captured email → accept
  // → owner creates role "Support" with ["access.staff.read"] → assigns it
  const actions = (await ownerAgent.get("/api/v1/admin/audit/entries?pageSize=100")).body.data.map((e) => e.action);
  expect(actions).toEqual(expect.arrayContaining(["auth.session.login", "access.staff.invite",
    "auth.user.invite_accept", "access.role.create", "access.staff.roles_update"]));
  expect((await viewerAgent.post("/api/v1/admin/roles").send(role)).body.error.code).toBe("auth.forbidden");
  expect((await ownerAgent.get("/api/v1/admin/notifications")).body.data[0].title).toBe("New staff member");
});
it("seeds idempotently", async () => { await seed.run("development"); await seed.run("development"); expect(await userCount()).toBe(4); });
it("refuses to seed in production", async () => await expect(prodSeed.run("demo")).rejects.toThrow("Seeding is disabled in production"));
it("refuses to boot production with seeded accounts", async () =>
  await expect(bootstrap({ env: prodEnvOnSeededDb })).rejects.toThrow("Seeded accounts exist"));
it("creates an owner who can sign in", async () => { /* owner:create → login 200, roleKeys ["owner"] */ });
it("refuses to purge an enabled module", async () => await expect(purge(["audit", "--yes"])).rejects.toThrow('Module "audit" is enabled'));
it("purges a disabled module's tables and tracking table", async () => { /* example module tables gone */ });
it("offers one-click login in demo only", async () => {
  expect((await demo.anon().get(demoAccounts)).body).toHaveLength(4);
  const a = demo.anon(); await a.post(demoLogin).send({ email: "viewer@demo.local" });
  expect((await a.get(session)).body.roleKeys).toEqual(["viewer"]);
  expect((await dev.anon().get(demoAccounts)).status).toBe(404);
  expect((await demo.anon().post(demoLogin).send({ email: "real@example.com" })).status).toBe(401);
});
it("restores seed data on reset", async () => { /* add a role → reset → 4 roles, 4 users */ });
it("keeps the committed API client in sync", async () => expect(await runApiClient(["--check"])).toBe(0));
```

- [ ] **Step 2: Run `pnpm --filter api test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run `pnpm modules:sync` and `pnpm api:client`; commit the generated output.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`, then `pnpm modules:sync --check`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): assemble core modules, CLI commands, demo mode and API client`

---

## Phase C: Admin panel

Component tests use Vitest with jsdom, Testing Library and `vitest-axe`. API calls are mocked at the `fetch` boundary. Every screen's text lives in its module's `admin/messages/en.json`; tests look elements up by role and accessible name.

### Task 18: UI primitives and feedback (`@platform/ui`)

**Files:**
- Create: `packages/ui/src/styles/tokens.css`, `packages/ui/src/primitives/*` (shadcn: button, input, label, textarea, select, checkbox, switch, dialog, sheet, dropdown-menu, popover, tooltip, tabs, badge, card, table, skeleton, command, separator, avatar, sonner)
- Create: `packages/ui/src/feedback/{confirm,empty-state,error-state}.tsx`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/{confirm,states,a11y}.test.tsx`

**Interfaces:**
- Produces:

```ts
export function confirm(opts: { title: string; body: string; confirmLabel: string; cancelLabel: string;
  destructive?: boolean; typeToConfirm?: string }): Promise<boolean>;
export function ConfirmHost(): JSX.Element; // mounted once by the shell
export const toast: { success(msg: string): void; error(msg: string): void };
export function EmptyState(p: { title: string; description?: string; action?: ReactNode }): JSX.Element;
export function ErrorState(p: { title: string; description?: string; retryLabel?: string; onRetry?: () => void }): JSX.Element;
```

- `tokens.css` defines colour, radius and spacing variables for light and dark (`[data-theme="dark"]`), including `--color-primary`, which the shell overrides from branding.

- [ ] **Step 1: Write the failing tests**

```tsx
it("resolves true on confirm and false on cancel or Escape", async () => { /* three cases */ });
it("keeps the confirm button disabled until the phrase is typed exactly", async () => {
  const p = confirm({ ...base, typeToConfirm: "Support" });
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  await user.type(screen.getByRole("textbox"), "support"); expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  await user.clear(screen.getByRole("textbox")); await user.type(screen.getByRole("textbox"), "Support");
  await user.click(screen.getByRole("button", { name: "Delete" })); expect(await p).toBe(true);
});
it("returns focus to the trigger when the dialog closes", async () => { /* document.activeElement === trigger */ });
it("ErrorState calls onRetry", async () => { /* click → called once */ });
it("has no axe violations in light or dark", async () => {
  for (const theme of ["light", "dark"]) expect(await axe(renderGallery(theme).container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run `pnpm --filter @platform/ui test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add the shadcn components with the shadcn CLI, targeting `packages/ui`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(ui): primitives, theme tokens and feedback components`

### Task 19: Admin kit and shell (`@platform/admin`, `apps/admin`)

**Files:**
- Create: `packages/admin/src/{api,session,public-config,permissions,i18n,navigation,providers,safe-next,index}.ts(x)`
- Create: `apps/admin/next.config.ts`, `apps/admin/src/app/{layout.tsx,[[...slug]]/page.tsx,globals.css}`
- Create: `apps/admin/src/shell/{resolver,app-layout,auth-layout,sidebar,top-bar,user-menu,theme-toggle,env-badge,demo-banner,module-boundary,not-found,forbidden}.tsx`, `apps/admin/messages/en.json`
- Test: `packages/admin/test/{api,safe-next,permissions}.test.tsx`, `apps/admin/test/{resolver,sidebar,branding}.test.tsx`

**Interfaces:**
- Consumes: `adminModules`, `manifests` (generated), `matchPage`, `PublicConfig`, `@platform/api-client` types.
- Produces:

```ts
export class ApiError extends Error { status: number; code: string; fields: Record<string, string[]>; requestId: string;
  constructor(status: number, code: string, fields?: Record<string, string[]>, message?: string, requestId?: string) }
export const api: { get<T>(path: string, query?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>; put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>; delete(path: string): Promise<void>;
  upload<T>(path: string, file: File): Promise<T> }; // base "/api/v1"; adds X-CSRF-Token on non-GET
export function useSession(): { status: "loading" | "signed-in" | "signed-out"; user?: SessionUser;
  permissions: string[]; mfaEnrollmentRequired: boolean; refresh(): Promise<void> };
export function usePublicConfig(): PublicConfig;
export function useCan(key: string): boolean;
export function Can(p: { permission: string; children: ReactNode }): JSX.Element | null;
export function useT(namespace: string): (key: string, values?: Record<string, unknown>) => string;
export function useNavigate(): (href: string) => void; export function Link(p: LinkProps): JSX.Element;
export function safeNext(raw: string | null): string; // "/" unless raw is a same-origin relative path
export function AdminProviders(p: { modules: AdminModuleDef[]; children: ReactNode }): JSX.Element;
```

- The admin always calls the relative path `/api/v1`. In development `next.config.ts` rewrites `/api/*` to `http://localhost:4000`; in deployment the reverse proxy does it. No environment value is baked into the build.
- Resolver rules, in order:
  1. Path matches no page → not-found screen (inside the app layout when signed in).
  2. `access: "public"` → render in the page's layout; a signed-in user on `/login` goes to `/`.
  3. Signed out → redirect to `/login?next=<path and query>`.
  4. `mfaEnrollmentRequired` and path is not `/profile` → redirect to `/profile`.
  5. Missing permission → forbidden screen.
  6. Otherwise render the page inside `ModuleBoundary`.
- Any API call answering 401 while signed in clears the session and redirects to `/login?next=<current path and query>`.
- `safeNext` accepts only values starting with a single `/` (not `//`, not `/\`) and containing no scheme.
- Sidebar: `registry.nav()` filtered by permission and by `feature` against `PublicConfig.features`. Below 1024 px it becomes a drawer opened from the top bar.
- `EnvBadge` shows the profile name for every `env` except production. `DemoBanner` shows when `env` is demo.
- The shell sets `--color-primary` and the document title from `PublicConfig`. Theme follows the system setting until the user picks one; the choice is kept in `localStorage`.

- [ ] **Step 1: Write the failing tests**

```tsx
it.each([["/staff", "/staff"], ["/roles/1?tab=x", "/roles/1?tab=x"], [null, "/"], ["//evil.example", "/"],
         ["https://evil.example", "/"], ["/\\evil.example", "/"], ["javascript:alert(1)", "/"]])(
  "safeNext(%j) → %s", (raw, out) => expect(safeNext(raw)).toBe(out));
it("adds the CSRF token to writes but not to GET", async () => { /* inspect fetch calls */ });
it("turns an error body into ApiError", async () =>
  await expect(api.get("/x")).rejects.toMatchObject({ status: 409, code: "request.conflict", requestId: "r1" }));

it("shows not-found for an unknown path", async () => { renderAt("/nope", signedIn); expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible(); });
it("redirects a signed-out visitor to login with next", async () => { renderAt("/staff?status=active", signedOut); await waitFor(() => expect(location()).toBe("/login?next=%2Fstaff%3Fstatus%3Dactive")); });
it("shows forbidden without the permission and keeps the sidebar", async () => {
  renderAt("/roles", signedInWith(["access.staff.read"]));
  expect(await screen.findByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
});
it("returns to the page you were on after the session expires", async () => {
  renderAt("/staff?page=2", signedIn); mockNext401();
  await user.click(await screen.findByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(location()).toBe("/login?next=%2Fstaff%3Fpage%3D2"));
});
it("contains a crashing page inside the shell", async () => {
  renderAt("/crash", signedIn); expect(await screen.findByText("This page failed to load")).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
});
it("lists only nav items the user may see, in order", async () => { /* permissions + feature filter */ });
it("ignores a path belonging to a module that is not enabled", async () => { /* "/reviews" → Page not found */ });
it("applies branding and hides the badge in production", async () => {
  renderAt("/", signedIn, { publicConfig: { ...cfg, env: "production", primaryColor: "#ff0000", storeName: "Acme" } });
  expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#ff0000");
  expect(document.title).toContain("Acme"); expect(screen.queryByTestId("env-badge")).toBeNull();
});
it("shows the demo banner in demo", async () => { /* env demo → banner visible */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** The catch-all page is a client component. Module `messages` are loaded and merged under the module id as namespace. Add the admin app to `pnpm dev`.
- [ ] **Step 4: Run the tests and `pnpm --filter admin build`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(admin): admin kit, page resolver and application shell`

### Task 20: Data table kit

**Files:**
- Create: `packages/ui/src/data-table/{data-table,pagination,column-menu,filter-bar,bulk-bar}.tsx`
- Create: `packages/admin/src/list/{list-state,use-list,saved-views,resource-table}.tsx`
- Test: `packages/admin/test/list/{list-state,resource-table,saved-views}.test.tsx`

**Interfaces:**
- Consumes: `api`, `useCan`, list standard from Task 6, saved-view routes from Task 15.
- Produces:

```ts
export interface ListState { page: number; pageSize: number; sort: string;
  filters: Record<string, string>; hiddenColumns: string[] }
export function toSearchParams(s: ListState, defaults: ListState): URLSearchParams; // omits default values
export function fromSearchParams(p: URLSearchParams, defaults: ListState): ListState; // invalid values fall back
export function toApiQuery(s: ListState): Record<string, string>; // page, pageSize, sort, filter[key]
export interface ColumnDef<T> { key: string; header: string; sortable?: boolean; hideable?: boolean; cell?: (row: T) => ReactNode }
export interface FilterDef { key: string; label: string; type: "text" | "select" | "date";
  options?: { value: string; label: string }[] }
export interface BulkAction<T> { id: string; label: string; permission: string; destructive?: boolean; run(rows: T[]): Promise<void> }
export function ResourceTable<T extends { id: string }>(p: { tableId: string; endpoint: string;
  columns: ColumnDef<T>[]; filters?: FilterDef[]; bulkActions?: BulkAction<T>[]; defaultSort: string;
  exportable?: boolean; rowHref?: (row: T) => string; emptyTitle: string; emptyAction?: ReactNode }): JSX.Element;
```

- Behaviour: state lives in the URL. Changing a filter or sort resets `page` to 1. Text filters debounce 300 ms. Selection clears when the page, sort or filters change. Bulk actions the user lacks permission for are hidden. Export opens `endpoint` with the current filters, sort and `format=csv`. Loading shows skeleton rows; failure shows `ErrorState` with retry; no rows shows `EmptyState`. If the last page becomes empty (for example after a delete), it steps back to the last page that has rows.

- [ ] **Step 1: Write the failing tests**

```tsx
const d: ListState = { page: 1, pageSize: 25, sort: "-createdAt", filters: {}, hiddenColumns: [] };
it("round-trips state through the URL", () => {
  const s = { ...d, page: 3, sort: "name", filters: { status: "active" }, hiddenColumns: ["email"] };
  expect(fromSearchParams(toSearchParams(s, d), d)).toEqual(s);
});
it("writes nothing for defaults", () => expect(toSearchParams(d, d).toString()).toBe(""));
it.each(["page=0", "page=abc", "pageSize=9999", "page=-1"])("falls back on %s", (q) =>
  expect(fromSearchParams(new URLSearchParams(q), d)).toEqual(d));
it("builds the API query", () =>
  expect(toApiQuery({ ...d, filters: { status: "active" } })).toEqual({ page: "1", pageSize: "25", sort: "-createdAt", "filter[status]": "active" }));
it("resets to page 1 when a filter changes", async () => { /* page=3 → change filter → request has page=1 */ });
it("toggles sort asc, desc on a sortable header and exposes aria-sort", async () => { /* aria-sort ascending → descending */ });
it("hides bulk actions without permission and clears selection on page change", async () => { /* two assertions */ });
it("steps back when the current page is past the end", async () => { /* total 25, page=2 → refetch page=1 */ });
it("shows empty, error and retry states", async () => { /* three cases */ });
it("links export to the same filters with format=csv", async () =>
  expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/v1/admin/staff?sort=-createdAt&filter%5Bstatus%5D=active&format=csv"));
it("saves, applies and deletes a view", async () => { /* POST saved-views → appears in menu → apply sets URL → delete */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** on TanStack Table and TanStack Query.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(admin): data table kit with URL state, bulk actions, saved views and export`

### Task 21: Form kit and resource pages

**Files:**
- Create: `packages/admin/src/forms/{zod-form,fields,schema-form,unsaved-guard}.tsx`
- Create: `packages/ui/src/pages/{list-page,detail-page,form-page}.tsx`
- Test: `packages/admin/test/forms/{zod-form,schema-form}.test.tsx`

**Interfaces:**
- Produces:

```ts
export function ZodForm<S extends ZodObject>(p: { schema: S; defaultValues: z.input<S>;
  onSubmit: (values: z.output<S>) => Promise<void>; submitLabel: string; children: ReactNode }): JSX.Element;
export function TextField(p: FieldProps): JSX.Element;       // FieldProps: { name: string; label: string; description?: string }
export function PasswordField(p: FieldProps): JSX.Element;   // with show/hide
export function SelectField(p: FieldProps & { options: { value: string; label: string }[] }): JSX.Element;
export function SwitchField(p: FieldProps): JSX.Element;
export function CheckboxGroupField(p: FieldProps & { groups: { label: string; options: { value: string; label: string }[] }[] }): JSX.Element;
export function ColorField(p: FieldProps): JSX.Element;
export function SchemaForm(p: { jsonSchema: object; value: unknown; submitLabel: string;
  onSubmit: (value: unknown) => Promise<void> }): JSX.Element; // string, number, integer, boolean, enum
export function ListPage(p: { title: string; actions?: ReactNode; children: ReactNode }): JSX.Element;
export function DetailPage(p: { title: string; backHref: string; actions?: ReactNode; children: ReactNode }): JSX.Element;
export function FormPage(p: { title: string; backHref: string; children: ReactNode }): JSX.Element;
```

- `ZodForm` behaviour: validates on submit and then on change. `ApiError.fields` are shown under the matching inputs and the first one is focused. Other `ApiError`s show `toast.error(message)`. A 409 shows an inline banner `Someone else changed this record. Reload to see the latest version.` with a Reload button, and keeps the user's input. The submit button is disabled and shows progress while saving, so a double click sends one request. With unsaved changes, leaving the page asks for confirmation.
- Every field has a `<label>`, links its error with `aria-describedby` and sets `aria-invalid`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows schema errors and does not submit", async () => { /* empty required field → message, onSubmit not called */ });
it("maps server field errors to inputs and focuses the first", async () => {
  onSubmit.mockRejectedValue(new ApiError(400, "request.validation_failed", { email: ["Already in use"] }));
  await submit(); expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Already in use");
  expect(screen.getByLabelText("Email")).toHaveFocus();
});
it("shows the conflict banner on 409 and keeps the typed values", async () => { /* banner text + input value intact */ });
it("sends one request on a double click", async () => { await user.dblClick(saveButton); expect(onSubmit).toHaveBeenCalledTimes(1); });
it("asks before leaving with unsaved changes, and not after saving", async () => { /* two cases */ });
it("renders a JSON Schema as fields and submits typed values", async () => {
  render(<SchemaForm jsonSchema={{ type: "object", properties: { retentionDays: { type: "integer", title: "Retention days" },
    enabled: { type: "boolean", title: "Enabled" } } }} value={{ retentionDays: 365, enabled: true }} submitLabel="Save" onSubmit={onSubmit} />);
  await user.clear(screen.getByLabelText("Retention days")); await user.type(screen.getByLabelText("Retention days"), "30");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSubmit).toHaveBeenCalledWith({ retentionDays: 30, enabled: true });
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** on React Hook Form with the Zod resolver.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(admin): form kit, schema-driven forms and resource page layouts`

### Task 22: Sign-in and profile screens (`auth`)

**Files:**
- Create: `modules/auth/admin/index.ts`, `modules/auth/admin/pages/{login,login-mfa,forgot-password,reset-password,accept-invite,profile}.tsx`, `modules/auth/admin/messages/en.json`
- Test: `modules/auth/test/admin/{login,accept-invite,reset,profile}.test.tsx`

**Interfaces:**
- Consumes: Tasks 10 to 12 routes, `ZodForm`, `useSession`, `safeNext`, `usePublicConfig`.
- Pages (`adminModule.pages`):

| Path | Access | Layout |
|---|---|---|
| `/login`, `/login/mfa`, `/forgot-password`, `/reset-password`, `/accept-invite` | `public` | `auth` |
| `/profile` | `authenticated` | `app` |

- Login: on `ok` go to `safeNext(next)`; on `mfa_required` go to `/login/mfa` keeping `next`. With feature `demo-login`, show one button per `GET /auth/demo-accounts` entry.
- Forgot password always shows `If that email has an account, a reset link is on its way.`
- Accept-invite and reset-password call the check or submit route and, on `auth.token_invalid`, show the server message with a link back to `/login`.
- Profile has three sections: details (name), password, and security (MFA enrol with secret and QR code, recovery codes shown once with a copy button, disable MFA; active sessions with sign-out per row). When `mfaEnrollmentRequired`, a notice explains that MFA must be set up to continue.

- [ ] **Step 1: Write the failing tests**

```tsx
it("signs in and follows a safe next", async () => { /* next=/staff → navigate("/staff") */ });
it("ignores an unsafe next", async () => { /* next=//evil.example → navigate("/") */ });
it("shows one message for any failed login", async () => expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password"));
it("goes to the MFA step when required", async () => { /* navigate("/login/mfa?next=...") */ });
it("offers demo accounts only with the demo-login feature", async () => { /* 4 buttons vs none */ });
it("shows the same confirmation whether or not the email exists", async () => { /* fixed sentence */ });
it("explains an invalid invite link and links to login", async () => {
  mockApiError(400, "auth.token_invalid", "This link is no longer valid. Ask for a new one.");
  expect(await screen.findByText("This link is no longer valid. Ask for a new one.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
});
it("shows recovery codes once after enabling MFA", async () => { /* 10 codes listed, gone after leaving */ });
it("signs out another session from the list", async () => { /* DELETE called, row removed */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run `pnpm modules:sync` if the admin entry is new.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(auth): sign-in, invite, reset and profile screens`

### Task 23: Staff and role screens (`access`)

**Files:**
- Create: `modules/access/admin/index.ts`, `modules/access/admin/pages/{staff-list,role-list,role-editor}.tsx`, `modules/access/admin/components/{invite-dialog,roles-dialog}.tsx`, `modules/access/admin/messages/en.json`
- Test: `modules/access/test/admin/{staff,roles}.test.tsx`

**Interfaces:**
- Consumes: Task 13 routes, `ResourceTable`, `ZodForm`, `CheckboxGroupField`, `confirm`, `Can`.
- Pages: `/staff` (`access.staff.read`), `/roles` (`access.role.read`), `/roles/new` (`access.role.create`), `/roles/:id` (`access.role.read`).
- Also registers a search source `access.staff` (permission `access.staff.read`) querying `GET /staff?filter[q]=`.
- Staff list: columns name, email, roles, status, last sign-in; filters status and search; export on. Row actions, each behind its permission: change roles, resend invite (invited users only), disable or enable. Disable asks for confirmation.
- Role editor: name, description and permissions grouped by module from `GET /permissions`, each group with select-all. The `owner` role renders read-only with the note `The owner role always has every permission.` Without `access.role.update` the form is read-only. Delete uses `typeToConfirm` with the role name.
- Known error codes show translated messages: `access.owner.last`, `access.role.in_use`, `access.role.escalation`, `access.staff.email_taken`, `access.staff.self`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("invites a staff member and shows them as invited", async () => { /* dialog → POST → row with status Invited */ });
it("shows the email-taken error under the email field", async () => { /* access.staff.email_taken */ });
it("hides the invite button without access.staff.invite", async () => expect(screen.queryByRole("button", { name: "Invite staff" })).toBeNull());
it("offers resend only for invited users", async () => { /* menu items differ by status */ });
it("explains why the last owner cannot be disabled", async () =>
  expect(await screen.findByText("At least one active owner is required.")).toBeVisible());
it("groups permissions by module with select-all", async () => {
  await user.click(screen.getByRole("checkbox", { name: "Select all Access permissions" }));
  expect(screen.getByRole("checkbox", { name: "Invite staff" })).toBeChecked();
});
it("renders the owner role read-only", async () => { /* all checkboxes disabled, note visible, no Save */ });
it("requires typing the role name to delete it", async () => { /* confirm disabled until name typed */ });
it("shows the conflict banner when the role changed elsewhere", async () => { /* 409 */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(access): staff and role management screens`

### Task 24: Audit viewer and dashboard

**Files:**
- Create: `modules/audit/admin/index.ts`, `modules/audit/admin/pages/{audit-list,audit-detail}.tsx`, `modules/audit/admin/widgets/recent-activity.tsx`, `modules/audit/admin/components/diff-view.tsx`, `modules/audit/admin/messages/en.json`
- Create: `apps/admin/src/shell/dashboard.tsx` (registered by the shell at path `/`, access `authenticated`)
- Test: `modules/audit/test/admin/{audit,diff}.test.tsx`, `apps/admin/test/dashboard.test.tsx`

**Interfaces:**
- Consumes: Task 14 routes, `ResourceTable`, `AdminWidget`.
- Produces: `diffEntries(before: unknown, after: unknown): { path: string; before: unknown; after: unknown; kind: "added" | "removed" | "changed" }[]` (flattens nested objects to dotted paths; unchanged paths omitted).
- Pages: `/audit` and `/audit/:id` (`audit.entry.read`). List columns: time, person, action, record; filters: person, action, record type, from, to; export on. Detail shows the metadata and the diff table.
- Widget `audit.recent-activity` (size `lg`, `audit.entry.read`) lists the latest 10 entries with a link to `/audit`.
- Dashboard: a responsive grid of the widgets the user may see, ordered by module order then widget id. With none, it shows `Nothing to show yet`.
- Times render in the user's locale in `usePublicConfig().timezone`; the raw ISO time is in the `title` attribute.

- [ ] **Step 1: Write the failing tests**

```tsx
it("diffs nested values by path", () =>
  expect(diffEntries({ name: "a", meta: { x: 1, y: 2 } }, { name: "b", meta: { x: 1, z: 3 } })).toEqual([
    { path: "name", before: "a", after: "b", kind: "changed" },
    { path: "meta.y", before: 2, after: undefined, kind: "removed" },
    { path: "meta.z", before: undefined, after: 3, kind: "added" }]));
it("handles a null before (create) and a null after (delete)", () => { /* all added / all removed */ });
it("shows redacted values as text, not as a change to reveal", async () => { /* "[redacted]" rendered literally */ });
it("lists entries with filters in the URL", async () => { /* filter[action]=access.role.update */ });
it("renders only permitted widgets", async () => { /* without audit.entry.read → "Nothing to show yet" */ });
it("isolates a failing widget from the rest of the dashboard", async () => { /* one throws, other still visible */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(audit): audit viewer, diff view and dashboard with recent activity`

### Task 25: Settings, notifications, demo inbox and command palette

**Files:**
- Create: `modules/settings/admin/index.ts`, `modules/settings/admin/pages/{general,modules,module-settings}.tsx`, `modules/settings/admin/messages/en.json`
- Create: `modules/notifications/admin/index.ts`, `modules/notifications/admin/pages/{notifications,demo-inbox,demo-inbox-detail}.tsx`, `modules/notifications/admin/components/bell.tsx`, `modules/notifications/admin/messages/en.json`
- Create: `apps/admin/src/shell/command-palette.tsx`; modify `apps/admin/src/shell/top-bar.tsx`
- Test: `modules/settings/test/admin/settings.test.tsx`, `modules/notifications/test/admin/{bell,inbox}.test.tsx`, `apps/admin/test/command-palette.test.tsx`

**Interfaces:**
- Consumes: Tasks 15 and 16 routes, `ZodForm`, `SchemaForm`, `SearchSource`, `PaletteCommand`.
- The notifications module registers its bell in `AdminModuleDef.topBar`; the top bar renders every registered entry.
- Pages:

| Path | Access |
|---|---|
| `/settings` (general form and logo upload) | `settings.value.read` |
| `/settings/modules` (enabled modules, switches, link to settings) | `settings.value.read` |
| `/settings/modules/:id` (`SchemaForm` from `GET /settings/:id`) | `settings.value.read` |
| `/notifications` | `authenticated` |
| `/demo-inbox`, `/demo-inbox/:id` | `notifications.demo-inbox.read` |

- Settings forms are read-only without `settings.value.update`; switches are disabled without `settings.switch.update`. A `demo.locked` error shows `This setting is locked in the demo.` Saving general settings refreshes `usePublicConfig` so the new name and colour apply at once.
- Bell: polls `unread-count` every 30 seconds, shows the count (`9+` above 9), and opens a popover with the latest 5 and a link to `/notifications`. Its accessible name includes the count.
- Captured email HTML is shown in an `<iframe sandbox="" srcDoc=...>`. It is never injected into the page.
- Command palette: opens with Ctrl+K or Cmd+K. It lists permitted nav items, permitted module commands, and results from permitted search sources (debounced 200 ms, minimum 2 characters). Enter navigates, Escape closes and restores focus.

- [ ] **Step 1: Write the failing tests**

```tsx
it("saves general settings and applies the new colour immediately", async () => { /* --color-primary updated */ });
it("renders read-only without settings.value.update", async () => { /* inputs disabled, no Save */ });
it("explains demo-locked settings", async () => expect(await screen.findByText("This setting is locked in the demo.")).toBeVisible());
it("toggles a module switch", async () => { /* PUT .../switches/guestReviews { enabled: false } */ });
it("links only modules that have settings", async () => { /* hasSettings false → no link */ });
it("shows 9+ and an accessible count on the bell", async () =>
  expect(await screen.findByRole("button", { name: "Notifications, 12 unread" })).toHaveTextContent("9+"));
it("renders captured email in a sandboxed frame", async () => {
  const frame = await screen.findByTitle("Email content");
  expect(frame).toHaveAttribute("sandbox", ""); expect(document.querySelector("script[data-from-email]")).toBeNull();
});
it("opens with Ctrl+K, filters nav by permission and navigates on Enter", async () => { /* three assertions */ });
it("does not query search sources the user cannot use", async () => { /* source.search not called */ });
it("shows results from a search source after two characters", async () => { /* "an" → hit listed */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run `pnpm modules:sync`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter admin build`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(admin): settings, notification centre, demo inbox and command palette`

---

## Phase D: End-to-end, delivery and docs

### Task 26: Browser tests

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/support/{stack,mailpit,totp}.ts`, `e2e/tests/{auth,staff-and-roles,audit,module-toggle,a11y}.spec.ts`, `e2e/tests-demo/demo.spec.ts`
- Modify: root `package.json` (script `e2e`)

**Interfaces:**
- Consumes: the running stack. `e2e/support/stack.ts` creates a fresh database, migrates, runs `owner:create` for `owner@e2e.test`, and starts the API and admin on free ports. The `development` project reads email from Mailpit's HTTP API (`http://localhost:8025`); the `demo` project starts the stack with `APP_ENV=demo` and seeded data.
- `module-toggle.spec.ts` runs `pnpm create:module example`, adds it to a copy of `store.config.ts` in a temp workspace copy, runs `modules:sync` and `db:migrate`, and starts that stack.
- Run with `--trace off`.

- [ ] **Step 1: Write the specs** (each fails until the stack helper exists)

```ts
test("owner signs in and sees the dashboard", ...);            // heading "Dashboard", env badge "development"
test("wrong password shows one generic error", ...);
test("invite → email link → accept → limited nav", ...);       // viewer sees Staff, not Settings
test("owner builds a role and assigns it", ...);               // role "Support" appears on the staff row
test("direct API call without permission is refused", ...);    // page.request.post("/api/v1/admin/roles") → 403 auth.forbidden
test("every step above appears in the audit log", ...);        // actions listed in /audit
test("MFA: enrol, sign out, sign in with a code", ...);        // code from e2e/support/totp.ts
test("expired session returns to the same page after login", ...); // clear cookies on /staff?status=active → act → login → same URL
test("enabled example module appears; removed module is gone", ...); // nav item + /example works, then 'Page not found' and API 404
test("login, staff, role editor and audit pages pass axe", ...);    // no serious or critical violations
// demo project
test("one-click login per role, banner, locked settings, demo inbox", ...);
```

- [ ] **Step 2: Run `pnpm e2e -- --trace off`.** Expected: FAIL at the first missing helper.
- [ ] **Step 3: Implement the support helpers and make each spec pass.** Fix any product defect a spec exposes in the owning module, with a unit or API test added there first.
- [ ] **Step 4: Run `pnpm e2e -- --trace off`.** Expected: all specs PASS.
- [ ] **Step 5: Commit.** `test(e2e): browser coverage for sign-in, staff, roles, audit, modules and demo`

### Task 27: CI, deployment and documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `deploy/{Dockerfile.api,Dockerfile.admin,compose.yml,Caddyfile,.env.example}`
- Modify: `apps/api/tsup.config.ts` (copy `modules/*/db/migrations` and `packages/server/db/migrations` to `dist/migrations/<id>`), `tools/db-generate/index.ts` (add `--check`), root `package.json` (script `db:check`)
- Create: `README.md`, `docs/environment.md`, `docs/new-client.md`, `docs/writing-a-module.md`
- Test: `tools/db-generate/test/check.test.ts`, `apps/api/test/migrations-path.test.ts`

**Interfaces:**
- `db:check` runs drizzle-kit generation for every module into a temp folder and exits 1, naming the module, if any schema has changes not captured in its committed migrations.
- CI job `check` (every pull request and push; `postgres:16` and Mailpit as service containers): `pnpm install --frozen-lockfile`, `lint`, `typecheck`, `test`, `build`, `modules:sync --check`, `api:client --check`, `db:check`, `pnpm audit --prod --audit-level high`. Job `e2e` (pushes to `main` and manual dispatch): `pnpm e2e -- --trace off`.
- `deploy/compose.yml` services: `postgres`, `migrate` (runs `db:migrate` once and exits), `api` (waits for `migrate`), `admin`, `caddy`. Caddy routes `/api/*` to `api:4000` and everything else to `admin:3000`. Images run as a non-root user.
- Docs content:
  - `README.md`: what the template is, requirements, quick start (`pnpm install`, `pnpm dev`, `pnpm seed --profile development`, sign in as `owner@demo.local`), command table, links to the other docs.
  - `docs/environment.md`: every variable, which profiles need it, the profile defaults table, the production guard list.
  - `docs/new-client.md`: clone, edit `store.config.ts`, `pnpm modules:sync`, set secrets, `pnpm db:migrate`, `pnpm owner:create`, deploy with `deploy/compose.yml`.
  - `docs/writing-a-module.md`: `pnpm create:module`, the manifest fields, the `MutationRunner` rule, declaring permissions and nav, adding settings and switches, emitting and handling events, running the contract suite, disabling and purging.

- [ ] **Step 1: Write the failing tests**

```ts
it("db:check passes when migrations match the schema", async () => expect(await check(fixtureInSync)).toEqual({ ok: true, drifted: [] }));
it("db:check names a module whose schema changed without a migration", async () =>
  expect(await check(fixtureDrifted)).toEqual({ ok: false, drifted: ["beta"] }));
it("finds bundled migrations when dist/migrations exists", () => { /* migrationsFolderFor("auth") ends with dist/migrations/auth */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement the check, the build copy step, the workflow, the deploy files and the four documents.**
- [ ] **Step 4: Verify.**
  - `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm modules:sync --check && pnpm api:client --check && pnpm db:check` → all pass.
  - `docker compose -f deploy/compose.yml config` → exits 0.
  - Where a Docker daemon is available: `docker compose -f deploy/compose.yml up --build -d`, then `curl -s localhost/api/v1/ready` → `{"status":"ready"}`. If no daemon is available, say so in the task report; do not claim this step passed.
  - Walk the spec's seven "Definition of done" points and record which test proves each.
- [ ] **Step 5: Commit.** `chore: CI workflow, deployment files and documentation`

