import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/config/env";
import { hasRole, type Role, type SessionUser } from "./roles";
import { readSessionCookie } from "./session";

/**
 * The entire authentication surface the rest of the application is allowed to
 * touch. Nothing outside lib/auth imports session, password, or the users
 * repository directly.
 *
 * Keeping it to three functions is what makes the system swappable. Replacing
 * this with Auth.js, an OIDC provider, or a reverse proxy that injects a header
 * means reimplementing these three and changing nothing else. See docs/AUTH.md.
 */

/**
 * The user every request is treated as when AUTH_ENABLED is false.
 *
 * It holds every role, so a deployment with authentication switched off behaves
 * exactly like a signed-in administrator rather than degrading into a
 * half-working read-only mode. `synthetic` lets the UI say so out loud, because
 * an unauthenticated deployment should be visibly unauthenticated.
 */
const LOCAL_USER: SessionUser = {
  id: 0,
  email: "local@localhost",
  name: "Local user",
  roles: ["viewer", "developer", "admin"],
  synthetic: true,
};

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isAuthEnabled()) return LOCAL_USER;
  return readSessionCookie();
}

/** Redirect to the login page when nobody is signed in. For pages and layouts. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** As requireUser, and additionally checks a role. Sends the unauthorized elsewhere. */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user.roles, role)) redirect("/");
  return user;
}

/**
 * Route handler variant. Returns null instead of redirecting, because an API
 * caller wants a 401, not a redirect to an HTML page.
 */
export async function requireApiUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

export async function requireApiRole(role: Role): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || !hasRole(user.roles, role)) return null;
  return user;
}
