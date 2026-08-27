# Deployment

## The constraint to decide first

`lib/jobs/store.ts` holds running scans in one process's memory. That works on a
long lived Node server and breaks on serverless or behind more than one
instance, where a job started by one worker is invisible to the next poll and
the dashboard waits forever on a scan that is running fine somewhere else.

So there are two shapes of deployment:

**One long lived instance** (a VM, a container, a single app service). Everything
works, including the Refresh data button. This is the recommended shape and it
is what the source system ran as.

**Serverless or multi-instance.** The dashboard, reports, and exports are all
fine, because they only read the database. But scanning from the browser will
not report progress reliably. Run scans from the CLI on a schedule instead and
hide the Refresh button, or build a real queue first. See the build order in
`docs/MONETIZATION.md`.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `AUTH_SECRET` | Yes, unless auth is disabled | At least 32 bytes. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `AUTH_ENABLED` | No | `false` disables sign-in entirely. Read `docs/AUTH.md` before using it |
| `GITHUB_TOKEN` | Only for scanning | Reading an already-populated dashboard needs no token |
| `SCAN_CONFIG_PATH` | No | Alternative scan config for the CLI. The server always uses the config it was deployed with |

Never bake `AUTH_SECRET` or `GITHUB_TOKEN` into an image. Both the Dockerfile
and the CI workflow use obvious placeholders for the build, because a real
credential in an image layer is readable by anyone who can pull it.

## Neon

1. Create a project at [neon.tech](https://neon.tech). The free tier is 0.5 GB,
   which is far more than this needs: roughly 5,000 commits is under 10 MB.
2. Copy the **pooled** connection string into `DATABASE_URL`.
3. `npm run db:migrate`.

Two things worth knowing about the free tier. Compute **scales to zero** when
idle, so the first request after a quiet period takes around half a second
longer. And a project is paused after long inactivity and has to be resumed from
the dashboard, so a dashboard nobody opens for months will need one click before
it works again.

Neon's **database branching** is genuinely useful here: branch the database,
point a scan at the branch, verify the numbers, then throw it away. That is the
safe way to test a change to the scanner against real data.

## Docker

```bash
docker compose up --build
```

Brings up Postgres and the application. `AUTH_SECRET` must be set in the
environment or in a `.env` file beside the compose file; the compose file fails
loudly rather than starting with a weak default.

The compose file is for running the thing end to end locally, not a production
deployment: the database password is in plain text and the volume is local.

Then, inside the running container:

```bash
docker compose exec app npx drizzle-kit migrate
docker compose exec app npx tsx scripts/create-user.ts --email you@example.com --role admin
```

## Vercel

Works, with the job-store caveat above. Set the environment variables in the
project settings and run migrations from CI or locally against the production
`DATABASE_URL`. Deploy hooks cannot run migrations for you.

Since scans cannot be driven from the browser reliably there, run them from a
scheduled job elsewhere, pointed at the same database.

## Scheduled scans

The CLI is the same code the button runs, so a scheduled scan and a manual one
cannot drift apart.

`npm run scan` exits **0** on success, **1** on failure, and **2** when the
rate-limit budget stopped it early with partial results. Treat 2 as "run again
after the quota resets", not as a failure: the next run continues from the
checkpoint.

**cron**, twice daily:

```cron
0 6,18 * * * cd /opt/team-github-dashboard && /usr/bin/npm run scan >> /var/log/tgd-scan.log 2>&1
```

**Windows Task Scheduler**: run `npm.cmd` with `run scan`, starting in the
project directory. Note that environment changes only reach newly created
processes, so a token updated in the user environment will not reach a task that
was already scheduled until it next starts fresh.

**A container**, on a schedule:

```bash
docker compose run --rm app npx tsx scripts/scan.ts
```

### How often

A daily scan is plenty for a dashboard read weekly. The expensive part is
enrichment, one API call per commit, and it is incremental: only new commits
cost anything. A first backfill over several years may need more than one run, a
day apart, because 5,000 requests an hour is the ceiling. That is expected, and
the checkpoint is what makes it finish.

## Upgrading

```bash
git pull
npm ci
npm run db:migrate
# restart the server
```

If `STATS_VERSION` changed, follow with `npm run enrich` to recompute statistics
under the new rules. Nothing breaks without it; the numbers just stay on the old
computation until you do.

## Backups

Everything lives in Postgres. Neon keeps point-in-time restore on paid plans; on
the free tier, take your own dump.

The data is reproducible in principle, since it all comes from GitHub, but
re-scanning years of history costs many hours of rate-limited requests. Treat
the database as the artifact worth backing up.

## Health

There is no dedicated health endpoint yet. `GET /api/auth/session` returns 200
with a JSON body and touches no database, which makes it a reasonable liveness
probe. For readiness, `GET /api/github/runs?limit=1` exercises the database.
