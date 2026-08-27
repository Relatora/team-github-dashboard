import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Edge-side gate for the dashboard routes.
 *
 * This only checks that a session cookie is PRESENT. It does not verify the
 * signature, because middleware runs on every matched request and the real
 * check belongs where the data is: requireUser() in the layout verifies the
 * token properly, and every route handler authenticates independently.
 *
 * So this is a redirect convenience, not a security boundary. Removing it would
 * cost a nicer sign-in flow, not access control. Treating it as the boundary is
 * the mistake to avoid: a forged cookie gets past here and is rejected one
 * layer down.
 */
export function middleware(request: NextRequest) {
  // The kill switch. Read from the raw environment rather than through
  // lib/config/env, because the Edge runtime cannot load the Node-only modules
  // that module pulls in transitively.
  if (process.env.AUTH_ENABLED === "false") return NextResponse.next();

  if (request.cookies.get(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL("/login", request.url);
  // Remember where they were headed so sign-in can return them there.
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/github/:path*"],
};
