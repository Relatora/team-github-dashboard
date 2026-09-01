# Architecture

One Next.js application. No separate services, no other runtimes.

```
Browser
  │
  ├─ /github ──────────────── dashboard (client components, TanStack Query)
  │
  └─ /api/*  ──────────────── route handlers
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
   lib/metrics             lib/report              lib/github
   (SQL aggregation)   (Markdown builder)      (scanner, one API gateway)
        │                       │                       │
        └───────────── lib/db (Drizzle) ────────────────┘
                              │
                          Postgres
```

The scanner is the only thing that talks to GitHub. Everything the dashboard
renders comes from Postgres, which is why the dashboard is fast, works offline,
and costs no API quota.

## The scan pipeline

`lib/github/run-scan.ts` is the whole sequence, shared by the HTTP job runner and
the CLI so a scheduled scan and a "Refresh data" click cannot drift apart.

1. **Preflight** (`client.ts`) reports what the token can do. Two failures are
   worth catching here because they look nothing like rate limiting later: an
   unauthenticated client gets 60 requests an hour and dies almost immediately,
   and a token without `read:org` makes member listing return an empty `200`.

2. **Discovery** (`discovery.ts`) lists repositories and branches, cached in
   `repo_branch_cache` keyed by scope. The default reuses the repository list
   but always re-lists branches: repositories rarely change and are expensive to
   enumerate, branches change constantly, and a branch created after the cache
   was written would otherwise be invisible.

3. **Branch walk** (`scan.ts`) fetches commits per branch, filtered server side
   by author where possible, deduplicated by SHA.

4. **Persist** (`repositories/commits.ts`) upserts the commits. This happens
   *before* enrichment, so an interrupted statistics run does not also lose the
   commits.

5. **Checkpoint** records which repositories finished, and clears itself once
   every repository in the scope is done.

6. **Enrich** (`enrich.ts`) fetches per-commit detail and computes both
   statistic sets, skipping anything already current.

7. **Record** writes a `runs` row, flagged incomplete if the budget guard fired.

## Invariants

Each of these cost real debugging time in the original implementation. They are
listed together so a future change can be checked against them.

### 1. Cleaned and raw are both stored, always

`commitStats()` returns both from one API response. Cleaned excludes
`statIgnoreGlobs` paths and counts merge commits as zero; raw is the unfiltered
diff. Storing both is what lets the dashboard toggle without re-fetching detail
for thousands of commits.

### 2. A scan must never clobber enriched statistics

Enrichment costs one API call per commit. A plain scan does not pay that, so it
has nothing to write. If it writes anyway, thousands of correct numbers are
destroyed silently: the dashboard starts reading "Cleaned: 0" and nothing errors.

The protection is in the statement, not in developer discipline:

```sql
ON CONFLICT (sha) DO UPDATE SET
  additions = COALESCE(EXCLUDED.additions, commits.additions),
  ...
```

The statistic columns are nullable specifically so NULL can mean "not enriched",
distinct from 0, which means "enriched, and nothing changed". Deleting a
`COALESCE` reintroduces the bug; forgetting something cannot.

The same shape protects issue authors: `nullif(excluded.author_login, '')` means
a later ingest that lost the author cannot blank one already captured.

### 3. STATS_VERSION gates re-enrichment

Enrichment skips SHAs already stored at the current version. That is the single
largest saving on a repeat scan. Bumping the constant forces a recompute of
everything on the next run, which is how a change to the statistics logic gets
applied to history.

### 4. One gateway to GitHub

Every request goes through `GitHubClient`, which reads the rate-limit headers
off every response. The budget accounting only works if nothing bypasses it.

Quotas are tracked per resource: core allows 5,000 requests an hour, search
roughly 30 a minute. Conflating them either stops a scan with thousands of core
requests left, or fails to stop one that has none.

### 5. Branch walking, never commit search

GitHub's commit search index only covers default branches. Switching to search
would be faster and would silently lose every project that develops on
`develop`. This is the reason the tool sees work the contribution graph does not.

### 6. The rate-limit floor throws, it does not return empty

Hitting the budget raises `RateLimitBudgetError`. Callers keep their partial
results and mark the run incomplete. A silent empty return would be
indistinguishable from "this person did no work", which is exactly the wrong
number for a tool whose entire purpose is not producing wrong numbers.

## Data model

| Table | Notes |
|---|---|
| `commits` | One row per commit, keyed by full SHA. Six nullable statistic columns plus `stats_version` |
| `issues` | `type` discriminates issues from items closed by the user |
| `pull_requests`, `reviews` | Only written when the matching `include*` flag is on |
| `runs` | One row per scan. `display_names` labels the roster |
| `app_settings` | Composite key `(user_email, app)`. `__global__` holds the org default |
| `users` | Accounts. Created by CLI; there is no signup route |
| `tracked_users` | People tracked deliberately, whether or not anything has been scanned for them |
| `scan_schedule` | The recurring scan, a single row |
| `secrets` | The GitHub token, encrypted. Never `app_settings`, which is sent to the browser |
| `scan_checkpoints`, `repo_branch_cache` | Resume state and discovery cache |

`(author_login, committed_at)` covers every dashboard query.

`scan_checkpoints` and `repo_branch_cache` are in the database rather than in
YAML files beside the script, which is what lets a scan resume on a host with no
durable filesystem and lets two instances share one cache.

## Two database drivers

`@neondatabase/serverless` offers both, and they are used for different things.

- **`lib/db/client.ts`** uses the HTTP driver: one statement per round trip, no
  held connection. Right for route handlers, which are short lived and may run
  in many instances. It cannot do transactions.
- **`lib/db/pool.ts`** uses the WebSocket pool, which speaks the real Postgres
  protocol and supports transactions. Used by the scanner and the CLI, where
  batched upserts need them. Callers must close it or a CLI script hangs on exit.

## The metrics query

The source was one MongoDB `$facet` with seven branches. Here it is seven
`GROUP BY` queries sharing one `WHERE` clause, issued together with
`Promise.all`. `$facet`'s single-pass advantage does not matter at this row
count, and separate statements are easier to read and index. The shared `WHERE`
is what stops them disagreeing about which commits they describe.

Date bounds are half open throughout: a user picking 31 March means through the
end of that day, so the exclusive upper bound is the next day. Comparing against
the same day drops everything committed after midnight on the last day.

## The roster

The list of selectable people is the UNION of two populations, and conflating
them was a real bug:

- **commit authors**, discovered from scanned data
- **tracked people** (`tracked_users`), added deliberately through the interface
  whether or not anything has been scanned for them

Deriving it from commits alone meant somebody only became selectable after a
scan had already found them, so a new joiner could not be added before their
first scan, and anyone with no commits in the scanned window never appeared.

`neverScanned` is what makes a zero readable. Zero commits after a real scan is
a fact about the person; zero before one is an absence of information. It is
cleared even when a scan finds nothing for someone, because that is precisely
the case it exists to separate.

Adding somebody does not scan them. Scanning spends an hour's API quota, so it
stays a deliberate act and a misclick in a member list costs nothing.

A scan with no explicit user list covers the whole roster, not only tracked
people. Tracked-only would quietly stop collecting for anyone scanned before
that table existed while still showing their old numbers, which reads as a drop
in output rather than a drop in coverage.

## Background jobs

`lib/jobs/store.ts` holds running scans in one process's memory, mirroring the
Python service.

**This assumes a long lived Node server** (`next start`). On serverless, or
behind more than one instance, a job started by one worker is invisible to the
next poll and the dashboard waits forever on a scan that is running fine
elsewhere. The upgrade path is a real queue: Redis, or a `jobs` table with a
worker. It is not built because a single-team deployment does not need it.

Only one scan runs at a time. A second request attaches to the one in flight
rather than being refused, because two concurrent scans would race for the same
rate-limit budget and both would stop early.

## The scheduler

`lib/schedule/runner.ts`, started from `instrumentation.ts`, is a one-minute
ticker that calls the same `startScanJob` the Refresh button uses. Reusing it is
deliberate: a scheduled scan and a clicked one cannot drift apart, and the
one-at-a-time rule above becomes the overlap policy for free.

**It carries the same single-process constraint as the job store**, for the same
reason. On serverless the ticker never runs; behind several instances each one
fires its own scan against a shared rate limit. The schedule modal says so and
offers the equivalent cron line, so the answer is visible where somebody needs
it rather than buried here.

Three details that are easy to get wrong:

- The slot is claimed **before** the scan starts. A scan runs for minutes, and
  the next tick would otherwise see the same overdue time and start another.
- An overdue `nextRunAt` at startup means the server was down through a slot, so
  it fires once rather than silently skipping. Silently skipping is the failure
  mode of most hand-rolled schedulers.
- Only a **successful** run advances `lastSuccessAt`. The since-last-success
  window reads that marker, so a failure must leave its gap for the next run
  rather than the marker sliding past data nobody collected.

Next-run times go through `date-fns-tz`. Hand-rolled arithmetic is correct for
ten months and an hour wrong for the two around a daylight saving change, and
monthly schedules must clamp to the last day of short months rather than skip
February entirely.
