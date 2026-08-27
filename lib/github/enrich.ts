import pLimit from "p-limit";
import type { GitHubClient } from "./client";
import { isRateLimitBudgetError } from "./errors";
import { commitStats, STATS_VERSION, type CommitDetail } from "./stats";
import type { PooledDatabase } from "@/lib/db/pool";
import { findCommitsNeedingStats, updateCommitStats } from "@/lib/db/repositories/commits";
import type { ScanConfig } from "@/lib/config";

/**
 * Fetch per-commit detail and compute the line statistics.
 *
 * This costs one API call per commit and is by far the most expensive part of
 * a run, which is why it is incremental: commits already stored at the current
 * STATS_VERSION are skipped entirely. Without that, refreshing a wide date
 * range re-fetches detail for thousands of unchanged commits and exhausts the
 * hourly quota for nothing.
 *
 * Bumping STATS_VERSION is how a change to the computation forces a recompute,
 * because every stored row then reads as out of date.
 *
 * Ported from enrich_commits_with_stats and enrich_mongo_commits in
 * github_work_report.py.
 */

export type EnrichResult = {
  examined: number;
  enriched: number;
  failed: number;
  /** True when the budget guard stopped the sweep before it finished. */
  stoppedEarly: boolean;
};

export type EnrichOptions = {
  client: GitHubClient;
  db: PooledDatabase;
  config: ScanConfig;
  /** Restrict to these author logins. Omit to sweep everyone in the data. */
  logins?: string[];
  /** Ceiling on commits examined in one run, to bound quota spend. */
  limit?: number;
  log?: (message: string) => void;
  onProgress?: (done: number, total: number) => void;
};

export async function enrichCommits(options: EnrichOptions): Promise<EnrichResult> {
  const { client, db, config, log = console.error } = options;

  const pending = await findCommitsNeedingStats(db, STATS_VERSION, {
    limit: options.limit ?? 5000,
    logins: options.logins,
  });

  if (!pending.length) {
    log("Every commit already has current statistics.");
    return { examined: 0, enriched: 0, failed: 0, stoppedEarly: false };
  }

  log(`Fetching detail for ${pending.length} commits.`);

  type Update = Parameters<typeof updateCommitStats>[1][number];
  const updates: Update[] = [];
  let failed = 0;
  let stoppedEarly = false;
  let done = 0;

  // Bounded concurrency. Higher finishes sooner but burns the hourly quota
  // faster, and the whole design is built around not doing that.
  const limit = pLimit(config.scanConcurrency);

  await Promise.all(
    pending.map((commit) =>
      limit(async () => {
        // Once the budget is gone, drain the remaining tasks without issuing
        // requests rather than letting each one throw in turn.
        if (stoppedEarly) return;

        try {
          const detail = await client.get<CommitDetail>(commit.apiUrl);
          const stats = commitStats(detail, config.statIgnoreGlobs, config.excludeMergeCommitsFromStats);
          updates.push({
            sha: commit.sha,
            additions: stats.additions,
            deletions: stats.deletions,
            filesChanged: stats.filesChanged,
            additionsRaw: stats.additionsRaw,
            deletionsRaw: stats.deletionsRaw,
            filesChangedRaw: stats.filesChangedRaw,
            isMerge: stats.isMerge,
            statsVersion: STATS_VERSION,
          });
        } catch (error) {
          if (isRateLimitBudgetError(error)) {
            if (!stoppedEarly) {
              stoppedEarly = true;
              log(`${(error as Error).message} Keeping the ${updates.length} results collected so far.`);
            }
            return;
          }
          failed += 1;
          return;
        }

        done += 1;
        options.onProgress?.(done, pending.length);
        if (done % 200 === 0) log(`  enriched ${done} of ${pending.length}`);
      })
    )
  );

  // Write whatever was collected, including after an early stop. Discarding
  // partial work would mean the next run pays for these calls again.
  const enriched = await updateCommitStats(db, updates);
  log(`Wrote statistics for ${enriched} commits${failed ? `, ${failed} failed` : ""}.`);

  return { examined: pending.length, enriched, failed, stoppedEarly };
}
