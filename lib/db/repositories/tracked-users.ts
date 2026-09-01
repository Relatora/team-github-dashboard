import { inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { trackedUsers, type TrackedUserRow } from "@/lib/db/schema";

/**
 * People the organization tracks, whether or not anything has been scanned for
 * them yet.
 *
 * Handles are stored lowercased and matched that way throughout, because GitHub
 * treats them case insensitively and the same person otherwise arrives as two
 * rows depending on who typed their name.
 */

export type TrackedUserInput = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

export async function listTrackedUsers(): Promise<TrackedUserRow[]> {
  return getDb().select().from(trackedUsers).orderBy(trackedUsers.displayHandle);
}

/**
 * Add people, or refresh the details of people already tracked.
 *
 * `addedAt` and `addedBy` are deliberately NOT updated on conflict: they record
 * when somebody was first tracked, and re-adding an existing person should not
 * rewrite that history. Display details are refreshed, since a name or avatar
 * genuinely can change.
 */
export async function addTrackedUsers(
  people: TrackedUserInput[],
  addedBy: string
): Promise<number> {
  const rows = people
    .map((p) => ({
      handle: p.handle.trim().toLowerCase(),
      displayHandle: p.handle.trim(),
      displayName: p.displayName ?? "",
      avatarUrl: p.avatarUrl ?? "",
      addedBy,
    }))
    .filter((r) => r.handle);

  if (!rows.length) return 0;

  await getDb()
    .insert(trackedUsers)
    .values(rows)
    .onConflictDoUpdate({
      target: trackedUsers.handle,
      set: {
        displayHandle: sql`excluded.display_handle`,
        // Never blank out a name that was captured once with an empty one.
        displayName: sql`nullif(excluded.display_name, '')`,
        avatarUrl: sql`nullif(excluded.avatar_url, '')`,
      },
    });

  return rows.length;
}

export async function removeTrackedUsers(handles: string[]): Promise<number> {
  const lower = handles.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!lower.length) return 0;

  const removed = await getDb()
    .delete(trackedUsers)
    .where(inArray(trackedUsers.handle, lower))
    .returning({ handle: trackedUsers.handle });

  return removed.length;
}

/**
 * Record that these people have now been scanned.
 *
 * Called after a scan finishes, so the "never scanned" badge clears even for
 * somebody the scan found no commits for. That case is the whole reason the
 * badge exists: zero commits after a real scan is a fact, zero before one is
 * an absence of information.
 */
export async function markScanned(handles: string[], when = new Date()): Promise<void> {
  const lower = handles.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!lower.length) return;

  await getDb()
    .update(trackedUsers)
    .set({ lastScannedAt: when })
    .where(inArray(trackedUsers.handle, lower));
}

/** Handles only. Original casing preserved, since GitHub's author filter wants it. */
export async function trackedHandles(): Promise<string[]> {
  const rows = await getDb()
    .select({ handle: trackedUsers.displayHandle, fallback: trackedUsers.handle })
    .from(trackedUsers);
  return rows.map((r) => r.handle || r.fallback);
}

/**
 * Everyone a scan should cover by default: tracked people AND anyone already
 * present in the commit data.
 *
 * Tracked people alone is wrong. Somebody scanned before this table existed is
 * not in it, so a scheduled scan would quietly stop collecting their work while
 * still showing their old numbers on the dashboard - a drop in coverage that
 * looks exactly like a drop in output.
 *
 * The union matches what the roster shows, which is the set the interface has
 * already told everyone is being tracked.
 */
export async function scanRosterHandles(): Promise<string[]> {
  const result = await getDb().execute<{ handle: string }>(sql`
    select coalesce(nullif(t.display_handle, ''), t.handle) as handle
    from tracked_users t
    union
    select distinct author_login as handle
    from commits
    where author_login <> ''
  `);
  return result.rows.map((r) => r.handle).filter(Boolean);
}
