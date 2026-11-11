# Foundation Design

- **Author:** Ahd-Rizlan
- **Date:** 2026-11-11
- **Status:** Draft for review
- **Spec:** 1 of 5 (Foundation)

## 1. Purpose

Build a reusable e-commerce admin panel template that can be cloned and
configured for any business: clothing stores, electronics, grocery, digital
goods, services. Features plug in or out per client, and demo, development,
staging and production run from the same code with different configuration.

This spec covers the Foundation only: the platform every later feature
builds on. It delivers no commerce features (no products, orders or
customers). Those come in spec 2.

### Decisions already made

| Decision | Choice |
|---|---|
| Backend | The template ships its own API and database |
| Deployment model | One clone per business, each with its own database |
| Stack | Next.js admin, NestJS API, PostgreSQL, TypeScript throughout |
| Scope | Admin panel plus API. No customer-facing storefront |
| Plug-in mechanism | Modules selected in config at build time, plus runtime switches for sub-features of enabled modules |
| Database layer | Drizzle ORM (not Prisma) |
| Background jobs | pg-boss on PostgreSQL (no Redis) |

### Non-goals for Foundation

- Catalog, inventory, orders, customers, discounts or any commerce feature.
- Shopper accounts, cart or checkout (`/store/*` is reserved, not built).
- Payment, shipping, SMS, search or tax providers.
- Multi-tenancy. One deployment serves one business.
- Single sign-on (Google or other OIDC). The sign-in layer leaves room for it.
- A marketplace of third-party plugins or a versioned plugin SDK.

### Roadmap context

| Spec | Contents |
|---|---|
| 1. Foundation (this document) | Monorepo, config and environments, sign-in and roles, module system, admin shell, UI kit, audit log, CI |
| 2. Core commerce | Catalog with custom attributes, inventory, orders, customers, dashboard, settings |
| 3. Shopper API and adapters | Cart, checkout, shopper accounts; payment, shipping, email and storage providers with fakes for demo |
| 4. First optional modules | Discounts, returns, content, reviews |
| 5. Advanced modules | Multi-store, marketplace, B2B, POS, analytics, AI, added as clients need them |

## 2. Repository layout

A pnpm workspace orchestrated by Turborepo.

```
apps/
  api/            NestJS API
  admin/          Next.js admin panel
packages/
  core/           module contract, permission and event types, registry
  config/         typed config schema, environment profiles, loader
  db/             database client, migration runner, shared column helpers
  server/         shared NestJS infrastructure: guards, mutation runner, events, jobs
  ui/             presentational components: data table, forms, layout, feedback
  admin/          runtime kit for module screens: API client, session, permissions
  api-client/     typed client generated from the API's OpenAPI spec
modules/
  auth/           staff accounts, sessions, MFA, invites, password reset
  access/         roles and permissions
  audit/          audit log
  settings/       store profile, branding, per-module settings
  notifications/  in-app notification centre and email delivery
store.config.ts   which modules and providers this clone uses
```

Each unit has one job:

| Unit | Does | Depends on |
|---|---|---|
| `packages/core` | Defines what a module is and holds the registry | nothing |
| `packages/config` | Loads and validates configuration | `core` |
| `packages/db` | Connects to PostgreSQL and runs module migrations | `config` |
| `packages/server` | HTTP conventions, route guards, mutation runner, outbox events, jobs, test helpers | `core`, `config`, `db` |
| `packages/ui` | Presentational building blocks | nothing project-specific |
| `packages/admin` | API client, session and permission hooks, list and form helpers for module screens | `core`, `ui`, `api-client` |
| `packages/api-client` | Typed HTTP client for the admin (and later storefronts) | generated from `apps/api` |
| `apps/api` | Hosts the enabled modules' API parts | `core`, `config`, `db`, `server`, modules |
| `apps/admin` | Hosts the enabled modules' screens | `core`, `ui`, `admin`, modules |

## 3. The module contract

### 3.1 Module anatomy

Every feature, including the five Foundation modules, is a folder under
`modules/` with the same shape:

```
modules/<id>/
  manifest.ts     identity and declarations (pure data, no framework imports)
  api/            NestJS module, controllers, services
  admin/          screens, dashboard widgets, search and command providers
  db/
    schema.ts     Drizzle table definitions
    migrations/   this module's own SQL migrations
  package.json    exports ./manifest, ./api and ./admin separately
```

The API and admin parts are separate package entry points so the admin
bundle never pulls in server code, and the reverse.

### 3.2 Manifest

```ts
export interface ModuleManifest {
  id: string;                    // kebab-case, unique, e.g. "audit"
  name: string;                  // display name
  core?: boolean;                // true: always on, cannot be disabled
  dependsOn?: string[];          // ids of modules that must also be enabled
  permissions: PermissionDef[];  // e.g. { key: "audit.entry.read", label }
  nav?: NavItem[];               // sidebar entries, each tied to a permission
  options?: ZodObject;           // schema for this module's entry in store.config.ts
  settings?: ZodObject;          // schema rendered as a form in Settings
  switches?: SwitchDef[];        // runtime on/off toggles for sub-features
  events?: { emits: string[]; handles: string[] };
}
```

Rules:

- Permission keys are prefixed with the module id: `<module>.<resource>.<action>`.
- Database tables are prefixed with the module id: `auth_users`, `audit_entries`.
- A module may declare a foreign key to another module's table only if that
  module is listed in `dependsOn`.
- The five Foundation modules set `core: true`.

### 3.3 How plugging in works

`store.config.ts` is plain data:

```ts
export default defineStore({
  modules: {
    auth: {},
    access: {},
    audit: { retentionDays: 365 },
    settings: {},
    notifications: {},
  },
  providers: { email: "smtp", storage: "s3", errorTracking: "sentry" },
  branding: { name: "Acme Store", primaryColor: "#2563eb", logo: "./logo.svg" },
  locale: { default: "en", currency: "USD", timezone: "UTC" },
});
```

`pnpm modules:sync` reads this file and:

1. Validates every id exists, every `dependsOn` is satisfied, and no core
   module is missing. It fails with a message naming the problem.
2. Validates each module's options against the module's own schema.
3. Writes `apps/api/src/modules.generated.ts` and
   `apps/admin/src/modules.generated.ts` with static imports of the enabled
   modules only.

The generated files are committed. CI re-runs the command and fails if the
output differs, so config and generated imports cannot drift.

A disabled module is never imported. It contributes no routes, tables, nav
items, permissions or bundle size.

### 3.4 Module registry at runtime

- **API:** `apps/api` imports the generated list and registers each NestJS
  module. The registry exposes enabled manifests so `access` can list all
  permissions and `settings` can list all settings schemas.
- **Admin:** a single catch-all route resolves the URL against the pages
  registered by enabled modules. Modules add screens without touching the
  app's route folders. Each module's screens render inside their own error
  boundary.

### 3.5 Communication between modules

- A module may call the exported services of modules it depends on.
- A module must not query another module's tables directly.
- Looser coupling goes through events (`auth.user.invited`,
  later `order.placed`). Events are written to an outbox table in the same
  database transaction as the change and delivered by pg-boss after commit.
  A rolled-back change never fires an event. Handlers must be idempotent,
  because delivery is at-least-once.

### 3.6 Runtime switches

Switches declared in a manifest are stored in the database and edited from
the module overview screen. They toggle behaviour inside an enabled module;
they never enable or disable a whole module.

### 3.7 Database and migrations

- Drizzle ORM with the `pg` driver.
- Each module owns its schema and its own migrations folder.
- The runner in `packages/db` applies migrations module by module in
  dependency order, giving each module its own migrations table
  (`migrationsTable: "__migrations_<module>"`). This was confirmed against
  drizzle-orm 0.45.4, whose `migrate()` accepts `migrationsFolder`,
  `migrationsTable` and `migrationsSchema`.
- Enabling a module later runs only that module's migrations.
- Disabling a module leaves its tables in place. Dropping them is a
  separate, explicit `pnpm modules:purge <id>` command that asks for
  confirmation, so data is never lost by a config edit.

Why Drizzle and not Prisma: Prisma requires a relation to be declared on
both models, so an optional module could not link to a core table without
editing the core module's schema. Drizzle foreign keys are one-sided.

### 3.8 Shared data conventions

Set now so every later module agrees:

- Primary keys are UUIDv7.
- Every table has `created_at` and `updated_at`.
- Business records are soft-deleted with `deleted_at`.
- Editable records carry a `version` column. An update with a stale version
  returns a conflict error; it does not silently overwrite.
- Money is stored as an integer in minor units plus an ISO currency code.

## 4. Configuration and environments

### 4.1 Two layers

| Layer | Holds | Committed |
|---|---|---|
| `store.config.ts` | Modules, provider choices, branding, locale | Yes |
| Environment variables | Secrets and deployment details: database URL, API keys, public URLs, `APP_ENV` | No |

Both are validated against one Zod schema when the API starts. A missing or
malformed value stops the boot with a message naming the field. Each
environment has a committed `.env.<profile>.example` listing its variables.

### 4.2 Profiles

`APP_ENV` is one of `demo`, `development`, `staging`, `production`. It is
separate from `NODE_ENV`. Each profile is a set of defaults that
`store.config.ts` may override.

| | Demo | Development | Staging | Production |
|---|---|---|---|---|
| Email provider | `capture` (in-app inbox) | `mailpit` | Real, sandbox credentials | Real |
| Storage provider | `local` | `local` | `s3` | `s3` |
| Data | Seeded, reset on a schedule | Seeded on demand | Empty or copied | Real |
| Sign-in | One-click per role | Seeded users | Normal | Normal, MFA enforceable |
| Extras | Demo banner, risky settings locked | Debug logs, API docs page | Error tracking | Error tracking, rate limits, strict headers |

### 4.3 Providers

A provider is an interface with several implementations, chosen by config
and injected. Foundation defines three:

| Provider | Implementations |
|---|---|
| Email | `capture`, `mailpit`, `smtp` |
| Storage | `local`, `s3` (any S3-compatible service) |
| Error tracking | `none`, `sentry` |

Later specs add payment, shipping, SMS, search and tax the same way.

### 4.4 Guard rails

- Production refuses to start if any of these is true: a fake or capture
  provider is selected, a required secret is missing, one-click demo login
  is on, or a seeded default account exists.
- Module and feature code never reads `process.env` and never branches on
  `APP_ENV`. It receives a typed config service and the injected provider.
  A lint rule enforces this outside `packages/config`.
- The admin app is built once. At load it fetches branding, enabled modules
  and the environment label from a public config endpoint, so one build
  runs in every environment.

### 4.5 Commands

| Command | Does |
|---|---|
| `pnpm dev` | Starts PostgreSQL and Mailpit in Docker, runs migrations, starts the API and admin |
| `pnpm modules:sync` | Validates `store.config.ts` and regenerates module imports |
| `pnpm db:migrate` | Applies pending migrations for enabled modules |
| `pnpm seed --profile <demo\|development>` | Loads sample data. Refuses to run when `APP_ENV=production` |
| `pnpm owner:create` | Creates the first owner account for a real install. Loads no sample data. (`pnpm setup` is reserved by pnpm itself) |
| `pnpm create:module <id>` | Scaffolds a new module folder |
| `pnpm modules:purge <id>` | Drops a disabled module's tables after confirmation |

## 5. Sign-in (`auth` module)

Staff accounts only.

- Email and password, hashed with argon2id.
- Server-side sessions stored in PostgreSQL, carried by an httpOnly, secure,
  SameSite cookie, with CSRF protection on state-changing requests.
  Sessions were chosen over JWTs in browser storage because they can be
  revoked immediately and are not readable by scripts.
- Optional TOTP MFA with single-use recovery codes. Config can require MFA
  for named roles.
- Staff invites and password resets use single-use, expiring tokens sent by
  email. Only a hash of each token is stored.
- Login attempts are rate-limited per account and per IP, with a temporary
  lockout after repeated failures. Responses do not reveal whether an email
  is registered.
- Users can list their active sessions and revoke them. Changing a password
  revokes all other sessions.
- Sign-in sits behind a strategy interface so an SSO module can be added
  later without changing session handling.

## 6. Roles and permissions (`access` module)

- Permissions are the keys declared in enabled modules' manifests.
- A role is a named set of permission keys stored in the database.
- **Owner** holds every permission, cannot be edited or deleted, and at
  least one active owner must always exist.
- **Admin**, **Manager** and **Viewer** are seeded as editable starting
  points. Custom roles can be created.
- A user may hold several roles. Effective permissions are the union.
- **Deny by default.** Every API route declares a required permission or is
  explicitly marked public. A test fails the build if a route does neither.
- The admin app receives the user's effective permissions to hide nav items
  and buttons. The server check is the authority.
- When a module is disabled, its permissions disappear from the role editor
  and are ignored in stored roles.

## 7. Audit log (`audit` module)

- Append-only. No update or delete endpoint exists.
- Each entry records actor, action, record type and id, before and after
  values, IP address, user agent, timestamp and request id.
- Every change goes through a shared mutation runner that wraps the
  database transaction and records the before and after values, so module
  authors do not hand-write audit calls. Sign-in, failed sign-in, sign-out,
  MFA changes, invites and role changes are recorded too.
- A check on every staff route fails, outside production, any successful
  change that wrote no audit entry, unless the route is explicitly exempt.
- Fields marked sensitive in a module's schema (password hashes, tokens,
  secrets) are redacted before the entry is stored.
- A viewer screen filters by person, action, record and date range.
- Entries older than the configured retention period are removed by a
  scheduled job.

## 8. Admin shell and UI kit

### 8.1 Stack

Next.js App Router, Tailwind, shadcn/ui, TanStack Query, TanStack Table,
React Hook Form with Zod, next-intl. The typed API client is generated from
the API's OpenAPI document.

### 8.2 Shell

- **Sidebar** built from enabled modules' nav items, filtered by
  permission. Collapses to a drawer on small screens.
- **Top bar** with command palette and global search (Ctrl+K),
  notification bell, environment badge and user menu.
- **Branding** (logo, store name, primary colour) from config, applied as
  CSS variables.
- **Themes:** light and dark, following the system setting with a manual
  override.

### 8.3 Kit

| Piece | What it gives a module |
|---|---|
| Data table | Server-side paging, sorting, filtering; column show/hide; saved views; row selection with bulk actions; CSV export; state kept in the URL |
| Form kit | Schema validation, standard fields, unsaved-changes warning, server field errors mapped to inputs |
| Resource pages | List, detail and create/edit patterns so a basic CRUD screen is mostly configuration |
| Feedback | Toasts, confirm dialogs (typed confirmation for destructive actions), skeletons, empty and error states |
| Dashboard grid | Modules register widgets. Foundation ships a recent-activity widget fed by the audit log |
| Settings area | Each module's settings schema is rendered as a form automatically |
| Notification centre | Any module can post in-app notifications, with optional email delivery |
| Search and commands | Modules register search sources and palette commands |

### 8.4 Baseline quality

- All text goes through translation files. English ships first. Layouts use
  logical CSS properties so right-to-left languages work.
- Keyboard navigable, labelled controls, WCAG AA contrast.

### 8.5 Screens delivered by Foundation

- Login, MFA challenge, forgot password, reset password, accept invite.
- My profile and security (password, MFA, sessions).
- Staff list and invite.
- Role list and role editor.
- Audit log viewer.
- Dashboard.
- General settings (store profile and branding).
- Module overview (enabled modules and their runtime switches).
- Notification centre.
- Demo inbox (captured emails), shown only when the `capture` email
  provider is active.

## 9. API conventions

- REST under `/api/v1`. `/admin/*` requires a staff session. `/store/*` is
  reserved for spec 3.
- Request bodies and queries are validated with Zod at the edge.
- One error shape:

  ```json
  { "error": { "code": "access.role.not_found", "message": "Role not found",
               "fields": {}, "requestId": "..." } }
  ```

  `code` is stable and machine-readable. `fields` carries per-field
  validation messages.
- One list standard: `page`, `pageSize` (capped), `sort`, `filter[...]`,
  returning `{ data, total, page, pageSize }`.
- Stale `version` on update returns HTTP 409 with a conflict code.
- The OpenAPI document is generated from the code and is the source for
  `packages/api-client`. CI fails if the committed client is out of date.

## 10. Errors, logging and security

- Structured JSON logs with a request id on every line. Secrets and
  personal data are not logged.
- Unhandled errors go to the error-tracking provider and return a generic
  message. Production responses never include stack traces.
- `/health` (process is up) and `/ready` (database reachable, migrations
  applied) endpoints.
- Security headers, a CORS allowlist from config, global and per-route rate
  limits, request size limits, and type and size checks on uploads.
- Dependency audit runs in CI.

## 11. Testing

Implementation is test-first.

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | Services, config validation, permission resolution, registry and dependency checks |
| API | Vitest against a real PostgreSQL 16 (a service container in CI), fresh database per test file | Every endpoint: success, validation failure, permission denied |
| Module contract | Shared suite run against every module | Valid manifest; every route has a permission or is public; migrations apply on a clean database; the app boots with the module on and (for non-core modules) off |
| Browser | Playwright | Sign-in, MFA, invite and accept, role editing, audit viewer, demo one-click login |
| Config | Vitest | Each profile boots; production rejects each unsafe setting |

An `example` module produced by `pnpm create:module` is used in tests to
prove the enable and disable path, since all five Foundation modules are
core.

## 12. CI and deployment

- GitHub Actions on every pull request: lint, type check, unit and API
  tests, build, `modules:sync` drift check, API client drift check,
  migration check, dependency audit. Browser tests run on the main branch
  and on demand.
- Dockerfiles for the API and admin. A compose file covers a single-server
  deploy (API, admin, PostgreSQL, reverse proxy). Migrations run as a
  release step before the new API version takes traffic.
- No specific cloud is assumed.

## 13. Documentation

- README with a quick start.
- Environment reference: every variable, which profiles need it.
- "Set up a new client" checklist: clone, edit `store.config.ts`, set
  secrets, run `pnpm owner:create`, deploy.
- "Write a module" guide matching what `pnpm create:module` generates.

## 14. Definition of done

1. On a fresh clone, `pnpm dev` brings the stack up and a seeded owner can
   sign in.
2. The owner can invite a staff member, who accepts by the emailed link,
   and can build a custom role and assign it. Every step appears in the
   audit log.
3. A staff member without a permission cannot see the related nav item and
   receives a permission error from the API if they call the route
   directly.
4. A module created with `pnpm create:module`, once added to
   `store.config.ts`, appears in the sidebar with its own table and
   permissions. Removing it from config and re-syncing removes its nav
   item, routes and permissions.
5. With `APP_ENV=production`, the API refuses to boot for each unsafe
   setting listed in section 4.4.
6. With `APP_ENV=demo`, one-click role login works, the banner shows,
   emails land in the demo inbox, and the scheduled reset restores seed
   data.
7. All CI checks pass.

## 15. Settled risk: per-module migrations

Checked on 2026-11-11 with drizzle-orm 0.45.4 and drizzle-kit 0.31.11, using
two throwaway modules where the second has a foreign key to the first's
table:

- `drizzle-kit generate` run per module produced a separate migration for
  each, with the cross-module foreign key in the second module's file.
- `migrate()` applied both with separate tracking tables
  (`__migrations_a`, `__migrations_b`) and was safe to run twice.

No fallback is needed.
