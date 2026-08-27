import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole, requireApiUser } from "@/lib/auth/guard";
import { resolveDevSettings, saveGlobalSettings, saveSettings } from "@/lib/settings";

/** GET /api/settings - the effective settings for the signed-in user. */
export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  return NextResponse.json(await resolveDevSettings(user.email));
}

const patchSchema = z.object({
  scope: z.enum(["me", "everyone"]).default("me"),
  devSettings: z.object({
    calcMode: z.enum(["cleaned", "raw"]).optional(),
    showRemoved: z.boolean().optional(),
    showIssues: z.boolean().optional(),
    shownUsers: z.array(z.string()).optional(),
  }),
});

/**
 * PATCH /api/settings - save dashboard settings.
 *
 * Developer role only. Scope "everyone" writes the organization-wide default
 * and clears the caller's personal override, so the value they just set is
 * actually what they see.
 */
export async function PATCH(request: Request) {
  const user = await requireApiRole("developer");
  if (!user) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings." }, { status: 400 });
  }

  const { scope, devSettings } = parsed.data;
  if (scope === "everyone") {
    await saveGlobalSettings(user.email, devSettings);
  } else {
    await saveSettings(user.email, { devSettings });
  }

  return NextResponse.json(await resolveDevSettings(user.email));
}
