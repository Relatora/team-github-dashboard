import { NextResponse } from "next/server";
import { z } from "zod";
import { burnVerifyTime, verifyPassword } from "@/lib/auth/password";
import { clientKey, rateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { isRole } from "@/lib/auth/roles";
import { setSessionCookie } from "@/lib/auth/session";
import { findUserByEmail, recordLogin } from "@/lib/db/repositories/users";
import { isAuthEnabled } from "@/lib/config/env";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1024),
});

/** Ten attempts per fifteen minutes from one address. */
const LIMIT = 10;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * One message for every failure.
 *
 * "No such account" and "wrong password" must be indistinguishable, or the
 * login form becomes an account enumeration oracle.
 */
const GENERIC_FAILURE = "Email or password is incorrect.";

export async function POST(request: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json(
      { error: "Authentication is disabled on this deployment." },
      { status: 404 }
    );
  }

  const key = clientKey(request);
  const limit = rateLimit(`login:${key}`, LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = await findUserByEmail(email);

  if (!user) {
    // Spend the same CPU time a real verification would, so the response
    // latency does not reveal that the account is missing.
    await burnVerifyTime(password);
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  resetRateLimit(`login:${key}`);
  await recordLogin(user.id);
  await setSessionCookie({
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.filter(isRole),
  });

  return NextResponse.json({ ok: true });
}
