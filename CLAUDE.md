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
  reasonable-looking change, and breaking it destroys data silently.
- `docs/PORTING.md` lists ten traps carried over from the original.

## Commands

```bash
npm run dev / build / lint / typecheck
npm run db:generate      # after editing lib/db/schema.ts
npm run db:migrate
npm run scan             # exits 2 when the rate limit stopped it early
npm run enrich
npm run seed-demo
npm run create-user -- --email you@example.com --role admin
npm run verify-invariants   # needs a database; see below
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
