# Authentication

This application does not depend on any identity provider. Everything lives in
`lib/auth/`, and the whole system is reachable through three functions so it can
be replaced without touching the rest of the codebase.

## The kill switch

Set `AUTH_ENABLED=false` and restart.

Every guard then returns a synthetic local user holding every role, the
middleware stops redirecting, and `/login` redirects away because there is
nothing to sign in to. Nothing else in the application changes: no code paths
are skipped, no features degrade, and a developer sees exactly what an
administrator sees.

This exists because "internal tool behind a VPN, everyone who can reach it is
already trusted" is a real deployment, and the alternative in that situation is
people sharing one account, which is worse.

**It is a real switch, so treat it as one.** With it off the application has no
access control at all. Anything that can reach the port can read every commit,
every author, and every report, and can start scans that spend your GitHub API
quota. Use it only where the network is the boundary.

The synthetic user is marked `synthetic: true` so the interface can say out loud
that authentication is disabled. An unauthenticated deployment should look
unauthenticated.

## The facade

`lib/auth/guard.ts` is the only auth surface the rest of the application
imports. Nothing outside `lib/auth/` reaches for `session.ts`, `password.ts`, or
the users repository.

```ts
getSessionUser(): Promise<SessionUser | null>   // who is here, or nobody
requireUser(): Promise<SessionUser>             // or redirect to /login
requireRole(role): Promise<SessionUser>         // or redirect away
```

Route handlers use `requireApiUser` and `requireApiRole`, which return `null`
instead of redirecting, because an API caller wants a 401 rather than an HTML
page.

## Replacing it

Reimplement those functions. That is the whole task.

**Auth.js / NextAuth.** Add the provider and its route, then have
`getSessionUser()` call `auth()` and map the session onto `SessionUser`. Delete
`password.ts`, the login page, and the login route. The `users` table stays if
you still want local roles, or roles move to the provider's claims.

Auth.js was considered for the initial build and not used, because it is still
`5.0.0-beta`, and its Credentials provider does no user management, so it would
have added a beta dependency without removing any of the code here.

**OIDC or SAML through your own IdP.** Same shape: the provider's callback sets
a session, and `getSessionUser()` reads it.

**A reverse proxy that authenticates for you** (oauth2-proxy, Cloudflare Access,
an internal SSO gateway). Have `getSessionUser()` read the header your proxy
injects, and confirm the application cannot be reached except through that
proxy. If it can, the header is attacker-controlled and this is worse than no
auth at all.

## Roles

`viewer`, `developer`, `admin`, defined in `lib/auth/roles.ts`. They are
additive: `admin` implies `developer` implies `viewer`, so a check for `viewer`
passes for anyone signed in.

They replace `TsDashBoardViewer`, `TsDeveloper`, and `SuperUser` from the source
client, which resolved role codes out of the ticketing system's own database.

- **viewer** sees the dashboard and can export.
- **developer** additionally gets the settings panel: cleaned versus raw
  counting, the lines-removed toggle, the shown-users whitelist, and the ability
  to scan for organization members not yet in the data.
- **admin** is reserved for account management.

## What is actually protecting things

| Concern | Mechanism |
|---|---|
| Password storage | argon2id, 19 MiB / 2 iterations / 1 lane, per OWASP |
| Account enumeration | One failure message, and `burnVerifyTime` so a missing account costs the same time as a wrong password |
| Session forgery | HS256 over `AUTH_SECRET`, issuer and audience both checked |
| Session theft via script | `httpOnly`, so JavaScript cannot read the cookie |
| Session theft in transit | `Secure` in production |
| CSRF | `SameSite=Strict`. Every state changing route authenticates from this cookie and a strict cookie is never sent cross site |
| Brute force | In-process rate limit, plus argon2's cost per attempt |
| Open redirect after sign-in | `?next=` is followed only when it is a same-site path |

`middleware.ts` checks only that a session cookie is **present**. It does not
verify the signature, because middleware runs on every matched request and the
real check belongs where the data is. It is a redirect convenience, not a
security boundary: a forged cookie gets past it and is rejected one layer down
by `requireUser()` and by each route handler.

## Known limits

- **No revocation.** There is no session table, so a stolen token stays valid
  until it expires. Rotating `AUTH_SECRET` invalidates every session at once,
  which is the blunt instrument available.
- **The rate limiter is per instance.** Behind several instances an attacker
  gets the limit multiplied by the instance count. Swap the map in
  `rate-limit.ts` for Redis if that matters.
- **No password reset flow.** An administrator runs
  `npm run create-user -- --email x --role y --reset`. A self service reset needs
  email delivery, which this deliberately does not depend on.
- **No MFA.** If you need it, that is a strong reason to move to an external
  provider rather than to extend what is here.

## Operating it

```bash
# Generate a signing key
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# Create the first account
npm run create-user -- --email you@example.com --role admin

# Reset a password or change roles
npm run create-user -- --email you@example.com --role developer --reset
```

`AUTH_SECRET` must be at least 32 bytes; startup refuses a shorter one, because
a weak session signing key is account takeover rather than a minor weakness.
