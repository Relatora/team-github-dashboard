import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/guard";
import {
  clearToken,
  readGhCliToken,
  storeToken,
  tokenStatus,
  validateToken,
} from "@/lib/github/token";

/**
 * Managing the GitHub token from the dashboard.
 *
 * The token value is never returned by any of these. Responses carry only
 * whether one is configured, where it came from, a four character hint, and the
 * account it validated as. A settings endpoint that hands the secret back is
 * one XSS away from leaking it.
 */

/** GET - the current state, for the settings row and the first-use prompt. */
export async function GET() {
  if (!(await requireApiRole("developer"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  return NextResponse.json(await tokenStatus());
}

const bodySchema = z.union([
  z.object({ mode: z.literal("token"), token: z.string().min(1).max(500) }),
  z.object({ mode: z.literal("gh-cli") }),
]);

/** PUT - set the token, either pasted or read from the gh CLI. */
export async function PUT(request: Request) {
  const user = await requireApiRole("developer");
  if (!user) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let token: string | null;
  if (parsed.data.mode === "gh-cli") {
    token = await readGhCliToken();
    if (!token) {
      return NextResponse.json(
        {
          error:
            "Could not read a token from the gh CLI. It needs to be installed and signed in " +
            "on the machine running this server, which is usually only true in development.",
        },
        { status: 400 }
      );
    }
  } else {
    token = parsed.data.token.trim();
  }

  // Validate before storing. A bad token saved quietly fails later, during a
  // scan, as an error that looks nothing like "the token is wrong".
  const validation = await validateToken(token);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  await storeToken(token, user.email, validation.login ?? "");

  return NextResponse.json({
    ...(await tokenStatus()),
    validated: {
      login: validation.login,
      coreRemaining: validation.coreRemaining,
      coreLimit: validation.coreLimit,
    },
  });
}

/** DELETE - remove the stored token. Any GITHUB_TOKEN in the environment takes over again. */
export async function DELETE() {
  if (!(await requireApiRole("developer"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  await clearToken();
  return NextResponse.json(await tokenStatus());
}
