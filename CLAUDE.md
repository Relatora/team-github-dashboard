# CLAUDE.md

Guidance for working in this repository.

## What this is

One Next.js application that scans a GitHub organization, stores commits in
Postgres, and renders a work dashboard plus an exportable report. It replaces a
three-tier system (Python FastAPI service, Express proxy, Vite/Kendo client)
described in `docs/PORTING.md`.

## Read these before changing the scanner or the database

- `docs/ARCHITECTURE.md` lists six invariants that each cost real debugging time
  in the original implementation. The never-clobber upsert in
  `lib/db/repositories/commits.ts` is the one most likely to be broken by a
  reasonable-looking change, and breaking it destroys data silently. The same
  rule is reimplemented, not shared, in `lib/store/sqlite/commits.ts` for the
  public demo - see the Storage layer section of ARCHITECTURE.md before
  touching either.
- `docs/PORTING.md` lists ten traps carried over from the original.
- Two in-process timers exist, the job store and the scheduler, and both assume
  a single long-lived server. Read the scheduler section of ARCHITECTURE.md
  before changing either.
- `docker compose down` keeps the database; `down -v` destroys it.

## Commands

```bash
npm run dev / build / lint / typecheck
npm run db:generate      # after editing lib/db/schema.ts
npm run db:migrate
npm run scan             # exits 2 when the rate limit stopped it early
npm run enrich
npm run seed-demo                          # your Postgres, for local evaluation
npm run seed-demo -- --target sqlite       # regenerates data/demo.sqlite, the /demo route's data
npm run create-user -- --email you@example.com --role admin
npm run verify-invariants                  # needs a database; see below
npm run verify-invariants -- --adapter sqlite  # same check against the demo dataset

docker compose up -d db     # local Postgres on :55432
npm run db:backup           # pg_dump to C:\AWrk\Docker\team-github-dashboard-app
npm run db:restore -- --latest --into tgd_scratch
```

There is no test suite yet. Three verification scripts cover the riskiest parts:

- `scripts/verify-categorize.ts` and `scripts/verify-ignore-globs.ts` compare the
  port against the Python original. They need no database and run in CI.
- `npm run verify-invariants` checks the never-clobber rule against a live
  database: enrich a commit, re-upsert it with no statistics, assert the numbers
  survived. Run it after touching the upsert in
  `lib/db/repositories/commits.ts`. Use a throwaway database or a Neon branch.

## Conventions

- **Never use the em dash character** in files, prose, comments, or commit
  messages. Use a hyphen, a colon, or reword.
- Comments explain why, not what. A comment that restates the line above it is
  noise; a comment naming the failure a line prevents is worth keeping.
- Every GitHub call goes through `GitHubClient`. Bypassing it breaks the
  rate-limit accounting for everything else.
- Nothing outside `lib/auth/` imports session, password, or the users
  repository. Use the three functions in `lib/auth/guard.ts`.
- Numbers quoted in documentation come from real runs, never estimates.
