# Amendment: Host Everything on Vercel

- **Date:** 2026-11-12
- **Amends:** `2026-11-11-foundation-design.md` (spec 1 of 5)
- **Status:** Accepted (owner decision: "Everything on Vercel")

## Decision

Both the admin panel (Next.js) and the API (NestJS) are deployed to Vercel.
The database is Neon PostgreSQL provisioned through the Vercel Marketplace.
There is no long-running server process in staging, production or demo.

## What stays the same

- The module contract, config, database layer, HTTP conventions, guards,
  mutation runner, audit enforcement and the outbox table.
- The `JobsService`, `EventBus`, `@OnEvent`, `MAILER`, `NOTIFIER` and
  `STORAGE` interfaces. Modules do not change.
- pg-boss stays as the durable job store (retries, backoff, dead letter).
  Local development and tests may keep the long-running worker.

## What changes

| Concern | Foundation spec | Vercel |
|---|---|---|
| API runtime | One long-running NestJS process | NestJS (Express adapter) exported as a single Vercel Function; app instance cached across warm invocations |
| Job execution | pg-boss workers poll continuously | No resident workers. A protected endpoint `POST /api/v1/internal/jobs/run` drains due jobs with `boss.fetch`/`complete`/`fail` until a time budget (default 50 s) is spent |
| Outbox dispatch | After each commit + every 5 s timer | After each commit (unchanged) + on every jobs-run invocation; no in-process timer in serverless mode |
| Scheduled jobs (`schedule(name, cron)`, demo reset) | pg-boss cron in the worker | Vercel Cron calls the jobs-run endpoint; the endpoint also runs pg-boss schedules that are due |
| Trigger frequency | Continuous | Vercel Cron: every minute needs the Pro plan (Hobby is once per day). Alternative: an external scheduler (e.g. Upstash QStash schedule) calling the same endpoint |
| Endpoint auth | n/a | `@Public` route guarded by a shared secret header (`CRON_SECRET`, read through `@platform/config`), constant-time compare; rejected without it |
| Database connections | `pg` pool on direct URL | Pooled Neon URL for request traffic (small pool per function instance); direct URL for migrations and pg-boss maintenance |
| Migrations | CLI before start | Run in the Vercel build step (or a CI step) against the direct URL, never at request time |
| File storage | `local` or `s3` | `s3`-compatible or Vercel Blob; `local` remains dev/test only (production guard already rejects it) |
| Email | SMTP | SMTP or an HTTP provider (e.g. Resend) behind `MAILER` |
| Demo profile | Long-running server with reset cron | Same app; reset runs through the jobs-run endpoint on its cron |
| Deployment artifacts (Task 27) | Dockerfiles, compose, Caddyfile | `vercel.json` per app (functions, crons, rewrites), env var docs; Docker/compose kept only for local development |

## New configuration

- `JOBS_MODE`: `worker` (default for development and tests) or `serverless`
  (staging, production, demo profiles). In `serverless`, `createApp` starts
  no pg-boss worker and no dispatcher timer.
- `CRON_SECRET`: required when `JOBS_MODE=serverless`.
- `DATABASE_URL_UNPOOLED` (optional): direct URL for migrations and pg-boss
  maintenance; defaults to `DATABASE_URL`.

All are read only in `@platform/config`, as profile-driven values (no APP_ENV
branching).

## Plan impact

- Phase A: no rework needed now. Interfaces are unchanged.
- Task 17 (API assembly, CLI, demo mode): adds the Vercel function entry,
  `JOBS_MODE`, the jobs-run endpoint and the serverless `JobsService`.
- Task 27 (CI, deployment, docs): targets Vercel instead of Docker/Caddy.
- Phase B modules: unchanged, except that anything time-based must use
  `JobsService.schedule`, never `setInterval`.

## Risks

- Cold starts on the API function (NestJS boot). Mitigated by caching the app
  instance and keeping the module graph lean.
- Job latency is bounded by the cron interval (up to 1 minute on Pro), except
  for events dispatched right after commit.
- Function duration limits cap a single jobs-run invocation; long jobs must be
  split.
