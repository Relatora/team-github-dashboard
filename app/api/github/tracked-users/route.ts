import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/guard";
import { addTrackedUsers, listTrackedUsers, removeTrackedUsers } from "@/lib/db/repositories/tracked-users";
import { GLOBAL_EMAIL, resolveDevSettings, saveSettings } from "@/lib/settings";

/**
 * The people the organization tracks.
 *
 * Adding somebody here does NOT scan them. That separation is the point:
 * scanning spends an hour's API quota, so it stays a deliberate act, and a
 * mistaken pick in the member list costs nothing.
 */

export async function GET() {
  if (!(await requireApiRole("developer"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  return NextResponse.json(await listTrackedUsers());
}

const addSchema = z.object({
  users: z
    .array(
      z.object({
        handle: z.string().min(1).max(120),
        displayName: z.string().max(200).optional(),
        avatarUrl: z.string().max(500).optional(),
      })
    )
    .min(1)
    .max(500),
});

export async function POST(request: Request) {
  const user = await requireApiRole("developer");
  if (!user) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const added = await addTrackedUsers(parsed.data.users, user.email);
  const handles = parsed.data.users.map((u) => u.handle);

  /**
   * Keep the shown-users whitelist consistent, which is wrong in both
   * directions if done naively.
   *
   * An EMPTY whitelist means "no restriction, show everyone". Appending to it
   * in that state would suddenly restrict the dashboard to only the people just
   * added, which is the opposite of what adding somebody should do.
   *
   * A NON-EMPTY whitelist is a deliberate curation, so new people must be
   * appended or they are tracked and then invisible with no explanation.
   */
  const { source, ...settings } = await resolveDevSettings(user.email);
  let whitelistUpdated = false;

  if (settings.shownUsers.length) {
    const existing = new Set(settings.shownUsers.map((h) => h.toLowerCase()));
    const missing = handles.filter((h) => !existing.has(h.toLowerCase()));
    if (missing.length) {
      // Write back to wherever the effective settings came from, so appending
      // to an org-wide whitelist does not quietly create a personal override
      // that then masks it.
      await saveSettings(source === "global" ? GLOBAL_EMAIL : user.email, {
        devSettings: { ...settings, shownUsers: [...settings.shownUsers, ...missing] },
      });
      whitelistUpdated = true;
    }
  }

  return NextResponse.json({ added, whitelistUpdated, users: await listTrackedUsers() });
}

const removeSchema = z.object({ handles: z.array(z.string()).min(1).max(500) });

/** Removal matters: without it a mistaken add is permanent. */
export async function DELETE(request: Request) {
  const user = await requireApiRole("developer");
  if (!user) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const removed = await removeTrackedUsers(parsed.data.handles);

  // Drop them from the whitelist too, or the dashboard keeps offering someone
  // who is no longer tracked.
  const { source, ...settings } = await resolveDevSettings(user.email);
  if (settings.shownUsers.length) {
    const gone = new Set(parsed.data.handles.map((h) => h.toLowerCase()));
    const kept = settings.shownUsers.filter((h) => !gone.has(h.toLowerCase()));
    if (kept.length !== settings.shownUsers.length) {
      await saveSettings(source === "global" ? GLOBAL_EMAIL : user.email, {
        devSettings: { ...settings, shownUsers: kept },
      });
    }
  }

  return NextResponse.json({ removed, users: await listTrackedUsers() });
}
