# Admin Template

pnpm + Turborepo monorepo: NestJS API (`apps/api`) and, later, a Next.js admin.

## Toolchain notes

- TypeScript is pinned to `^5.9`. TypeScript 7.0 is published, but `typescript-eslint` 8.x refuses to run on it ("does not support TS 7.0"). Revisit once typescript-eslint supports TS 7.
- Dev services: `docker compose -f docker-compose.dev.yml up` (PostgreSQL 16, Mailpit).

## Running the tests

Tests need a PostgreSQL 16 server. Each test file creates its own uniquely named `test_*` database and drops it afterwards.

- The server comes from `TEST_DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/postgres`, which matches `docker-compose.dev.yml`. Start it with `docker compose -f docker-compose.dev.yml up -d postgres`.
- To use another server without exporting a variable, put `TEST_DATABASE_URL=...` in a git-ignored `.env.test.local` at the repo root; the shared Vitest preset loads it. A value already in the environment wins.
- Changing `.env.test.local` or `TEST_DATABASE_URL` invalidates Turborepo's test cache, as does a change in any internal package a package depends on.

Commands:

- `pnpm test`: every package and module.
- `pnpm --filter @platform/server test`: one package (`@platform/db`, `@platform/config`, `@modules/<id>`, ...).
- `pnpm --filter @platform/server exec vitest run test/events/outbox.test.ts`: one file.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter api build`.

## Modules and migrations

- `pnpm create:module <id> ["Display name"]`: scaffolds `modules/<id>` (manifest, API module, schema, contract test), wires it into the apps and generates its first migration. Enable it in `store.config.ts`.
- `pnpm modules:sync`: regenerates the apps' module import lists from `store.config.ts`.
- `pnpm db:generate <module-id>`: generates a migration from `modules/<id>/db/schema.ts`.
- `pnpm db:generate:platform`: generates a migration for the platform's own tables (`packages/server/db`).

Permission keys are `<module-id>.<resource>.<action>`, lowercase (the manifest validator enforces it).

### Platform extension points

The platform consumes a few tokens that feature modules implement: `AUTHENTICATOR` (auth), `PERMISSION_RESOLVER` (access), `AUDIT_RECORDER` (audit), and `MAILER`, `NOTIFIER`, `STORAGE` (notifications and storage). A module that provides one **must be `@Global()` and list the token in `exports`**, otherwise the platform cannot see it. Without such a module the platform falls back to: nobody signed in, no permissions, audit entries dropped.

## Deployment notes

- `TRUST_PROXY` sets Express's "trust proxy", which decides the client IP used in logs, the request context and rate limiting. Leave it unset (or `false`) when clients connect directly. Behind a load balancer, set it to the number of proxy hops (usually `1`) or a comma-separated list of the proxies' addresses / CIDR ranges. Without it, every request behind a proxy shares the proxy's IP and its rate limit.
