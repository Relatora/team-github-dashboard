import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { repoBranchCache, scanCheckpoints } from "@/lib/db/schema";
import type { RepoBranchMap } from "@/lib/github/discovery";

/**
 * Discovery cache and scan resume state.
 *
 * The Python tool kept both in YAML files next to the script. Holding them in
 * the database instead is what lets a scan resume on a host with no durable
 * filesystem, and it means two instances share one cache rather than each
 * re-listing an entire organization.
 */

export async function loadRepoBranchCache(scopeKey: string): Promise<RepoBranchMap> {
  const rows = await getDb()
    .select()
    .from(repoBranchCache)
    .where(eq(repoBranchCache.scopeKey, scopeKey))
    .limit(1);
  return rows[0]?.mapping ?? {};
}

/**
 * Keyed by scope, so changing the repository list for one scan does not
 * invalidate the cache another scope is still using.
 */
export async function saveRepoBranchCache(scopeKey: string, mapping: RepoBranchMap): Promise<void> {
  await getDb()
    .insert(repoBranchCache)
    .values({ scopeKey, mapping, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: repoBranchCache.scopeKey,
      set: { mapping, updatedAt: new Date() },
    });
}

export async function loadCheckpoint(key: string): Promise<Set<string>> {
  const rows = await getDb()
    .select()
    .from(scanCheckpoints)
    .where(eq(scanCheckpoints.key, key))
    .limit(1);
  return new Set(rows[0]?.completedRepos ?? []);
}

export async function saveCheckpoint(key: string, completed: Set<string>): Promise<void> {
  await getDb()
    .insert(scanCheckpoints)
    .values({ key, completedRepos: [...completed], updatedAt: new Date() })
    .onConflictDoUpdate({
      target: scanCheckpoints.key,
      set: { completedRepos: [...completed], updatedAt: new Date() },
    });
}

/**
 * Clear the checkpoint once every repository in the scope has been scanned.
 *
 * Without this a completed scope stays marked done forever and the next run
 * skips everything, which looks exactly like a scan that found nothing.
 */
export async function clearCheckpoint(key: string): Promise<void> {
  await getDb().delete(scanCheckpoints).where(eq(scanCheckpoints.key, key));
}

/** Scope, period, and users together: a different window is a different resume state. */
export function checkpointKey(scope: string, startDay: string, endDay: string, users: string[]): string {
  return `${scope}|${startDay}..${endDay}|${[...users].sort().join(",")}`;
}
