# Admin Template

pnpm + Turborepo monorepo: NestJS API (`apps/api`) and, later, a Next.js admin.

## Toolchain notes

- TypeScript is pinned to `^5.9`. TypeScript 7.0 is published, but `typescript-eslint` 8.x refuses to run on it ("does not support TS 7.0"). Revisit once typescript-eslint supports TS 7.
- Dev services: `docker compose -f docker-compose.dev.yml up` (PostgreSQL 16, Mailpit).
