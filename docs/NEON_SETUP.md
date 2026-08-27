# Getting a Neon connection string

What to do to hand over a `DATABASE_URL`, and what to be careful about while
doing it. Takes about three minutes.

## 1. Create the project

1. Go to <https://neon.tech> and sign up. GitHub sign-in works and needs no
   card. The free plan is permanent, not a trial.
2. Create a project.
   - **Name**: anything. `team-github-dashboard` is fine.
   - **Postgres version**: take the default.
   - **Region**: pick the one closest to wherever this will run. It only affects
     latency, and it **cannot be changed later** without recreating the project.

Neon shows the connection string immediately after creation. If you navigate
away, it is under **Dashboard → Connect**, or **Project settings → Connection
details**.

## 2. Copy the right string

The dialog offers several. You want:

- **Connection pooling: ON.** This gives a host containing `-pooler`. The
  application opens a connection per request, and the unpooled endpoint runs out
  of connections under any real use.
- **Role**: the default (`neondb_owner`), since migrations need to create tables.
- **Database**: the default (`neondb`).

It looks like this:

```
postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-name-12345678-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Both `-pooler` in the host and `?sslmode=require` at the end matter. Keep them.

## 3. Handing it over

**That string contains a password.** Anyone holding it has full read and write
access to the database.

For this project that is a low-stakes secret: the database holds public GitHub
commit metadata and the application accounts you create, and it is brand new
with nothing in it. It is still a live credential, so:

- Paste it into the chat only if you are comfortable with it appearing in this
  session's transcript. It will.
- Or put it in `.env.local` yourself and tell me it is there. That file is
  gitignored, so it never reaches the repository, and I never need to see the
  value:

  ```
  DATABASE_URL="postgresql://...-pooler.../neondb?sslmode=require"
  ```

**The second option is better** and it costs nothing. I only need to know the
file exists to run the migration.

Either way, you can rotate the password afterwards from **Neon → Roles → Reset
password**, which invalidates the old string entirely.

## 4. Also needed

`.env.local` needs one more value, the session signing key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Put the output in `AUTH_SECRET`. This one should not be pasted anywhere: it
signs session tokens, so anyone who has it can forge a login. Generate it
locally and leave it in the file.

A finished `.env.local`:

```
DATABASE_URL="postgresql://neondb_owner:...@ep-...-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
AUTH_SECRET="the-32-byte-value-you-just-generated"
AUTH_ENABLED="true"
GITHUB_TOKEN=""
```

`GITHUB_TOKEN` can stay empty until you want to scan real data. The demo seed
and everything the dashboard renders work without it.

## 5. Then

```bash
npm run db:migrate
npm run seed-demo
npm run create-user -- --email you@example.com --role admin
npm run dev
```

Open <http://localhost:3000/github>.

## Free tier limits, and which ones you will actually notice

| Limit | Reality for this project |
|---|---|
| 0.5 GB storage per project | Roughly 5,000 commits is under 10 MB. Not a constraint |
| 100 compute hours per month | Compute scales to zero when idle, so a dashboard opened a few times a day uses very little |
| Scale to zero | The first request after a quiet period takes around half a second longer. Noticeable, harmless |
| Paused after long inactivity | A project untouched for a long stretch needs one click in the dashboard to resume |

The one to actually plan around is scale-to-zero latency, and only if this ever
gets a user-facing SLA.

## Branching, which is the genuinely useful part

Neon can branch a database the way git branches code, copy-on-write and instant.
That makes the risky operations safe to test:

```bash
# In the Neon dashboard: Branches -> New branch, from main
# Then point DATABASE_URL at the branch string and run whatever you want.
```

This is the right way to test a scanner change against real data, or to verify
that a re-scan does not wipe enriched statistics, without risking the real
numbers. Delete the branch afterwards.

## If something goes wrong

- **`password authentication failed`** - the string was truncated when copying.
  These are long; make sure you got all of it.
- **`too many connections`** - you used the non-pooled endpoint. Get the one
  with `-pooler` in the host.
- **`SSL connection required`** - `?sslmode=require` was dropped from the end.
- **Hangs, then a timeout** - the project is paused. Open the Neon dashboard and
  it resumes.
