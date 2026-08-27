import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/config/env";
import { isRole, type Role, type SessionUser } from "./roles";

export const SESSION_COOKIE = "tgd_session";

/**
 * Seven days. Long enough that a team member is not signing in daily, short
 * enough that a leaked token expires on its own. There is no refresh flow and
 * no server side session table, so this is also the maximum window in which a
 * stolen cookie is useful.
 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const ISSUER = "team-github-dashboard";

function secret(): Uint8Array {
  return new TextEncoder().encode(requireEnv("AUTH_SECRET"));
}

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  roles: Role[];
};

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, roles: user.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

/**
 * Verify a token and return the user it describes, or null.
 *
 * Issuer and audience are checked as well as the signature. Without them a
 * token signed by the same secret for a different purpose would be accepted
 * here, which matters as soon as this key is reused for anything else.
 */
export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: ISSUER,
      algorithms: ["HS256"],
    });

    const id = Number(payload.sub);
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!Number.isInteger(id) || !email) return null;

    const roles = Array.isArray(payload.roles) ? payload.roles.filter(isRole) : [];

    return {
      id,
      email,
      name: typeof payload.name === "string" ? payload.name : "",
      roles,
    };
  } catch {
    // Expired, tampered with, or signed by a different key. All of these mean
    // "not signed in" and none of them should surface as an error.
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    // SameSite=Strict is what covers CSRF here. Every state changing route
    // authenticates from this cookie, and a strict cookie is not sent on any
    // cross site request, so there is no separate CSRF token to manage.
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(user), cookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

export async function readSessionCookie(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}
