import { GitHubClient, preflight } from "./client";
import { isRateLimitBudgetError } from "./errors";
import { buildRepoBranchMap, filterScanBranches, type CacheMode } from "./discovery";
import { scanCommits, toCommitRow } from "./scan";
import { enrichCommits } from "./enrich";
import { normalizeIssue } from "@/lib/db/repositories/items";
import { getScanConfig, resolvePeriod, scopeKey, type ScanConfig } from "@/lib/config";
import { resolveToken } from "@/lib/github/token";
import { createPool } from "@/lib/db/pool";
import { upsertCommits } from "@/lib/db/repositories/commits";
import { recordRun, upsertIssues } from "@/lib/db/repositories/items";
import {
  checkpointKey,
  clearCheckpoint,
  loadCheckpoint,
  loadRepoBranchCache,
  saveCheckpoint,
  saveRepoBranchCache,
} from "@/lib/db/repositories/cache";
import type { RawIssue } from "./types";

/**
 * One scan, end to end: discover, walk, persist, enrich, record.
 *
 * Shared by the HTTP job runner and the CLI, so a scheduled scan and a
 * "Refresh data" click do exactly the same thing.
 */

export type ScanRequest = {
  users?: string[];
  startDate?: string;
  endDate?: string;
  /** Reuse the cached repository list and branches, or re-list them. */
  cache?: { repos: CacheMode; branches: CacheMode };
};

export type ScanOutcome = {
  counts: { commits: number; issues: number; repositories: number; enriched: number };
  period: { start: string; end: string };
  users: string[];
  incomplete: boolean;
  warnings: string[];
  apiRequests: number;
};

export async function runScan(
  request: ScanRequest = {},
  progress: (message: string) => void = console.error
): Promise<ScanOutcome> {
  const base = getScanConfig();
  // Per-request user override, so the dashboard can scan exactly who is on screen.
  const config: ScanConfig = request.users?.length
    ? { ...base, githubUsernames: request.users }
    : base;

  const period = resolvePeriod(config, { start: request.startDate, end: request.endDate });
  const warnings: string[] = [];

  const client = new GitHubClient({
    token: await resolveToken(),
    apiBase: config.githubApiBase,
    minRemaining: config.rateLimitMinRemaining,
    rateLimitAction: config.rateLimitAction,
    log: progress,
  });

  const check = await preflight(client);
  warnings.push(...check.warnings);
  for (const warning of check.warnings) progress(warning);
  progress(`GitHub quota: ${check.coreRemaining} of ${check.coreLimit} core requests remaining.`);

  const { db, close } = createPool();
  let incomplete = false;

  try {
    const scope = scopeKey(config);

    /**
     * Default: reuse the cached repository list but always re-list branches.
     *
     * Listing an organization's repositories is the expensive part and they
     * rarely change. Branches change constantly, and work pushed to a branch
     * created after the cache was written would otherwise be invisible, which
     * reads as "Refresh data found nothing".
     */
    const modes = request.cache ?? { repos: "cache" as CacheMode, branches: "scan" as CacheMode };

    const cached = await loadRepoBranchCache(scope);
    const discovered = await buildRepoBranchMap(client, config, cached, modes, progress);
    await saveRepoBranchCache(scope, discovered);

    const { filtered, before, after } = filterScanBranches(discovered, config);
    if (after < before) {
      progress(`Scanning ${after} of ${before} branches (branchScanScope is "active").`);
    }

    const key = checkpointKey(scope, period.startDay, period.endDay, config.githubUsernames);
    const skipRepos = await loadCheckpoint(key);

    const result = await scanCommits({
      client,
      config,
      start: period.start,
      end: period.end,
      repoBranches: filtered,
      skipRepos,
      log: progress,
    });

    incomplete = result.stoppedEarly;

    // Persist before enriching. Enrichment can be interrupted by the budget
    // guard, and losing the commits themselves because the statistics run out
    // of quota would be the worst of both.
    const rows = result.commits.map((c) => toCommitRow(c, c.repository?.full_name ?? ""));
    const commitsWritten = await upsertCommits(db, rows);
    progress(`Stored ${commitsWritten} commits.`);

    // Record which repositories finished, so a scope too large for one quota
    // window continues where it left off on the next run.
    const completed = new Set([...skipRepos, ...result.completedRepos]);
    if (completed.size >= Object.keys(filtered).length) {
      // Everything is scanned. Clearing matters: a checkpoint left in place
      // makes the next run skip every repository, which looks identical to a
      // scan that found nothing.
      await clearCheckpoint(key);
    } else {
      await saveCheckpoint(key, completed);
      progress(`Checkpoint saved: ${completed.size} of ${Object.keys(filtered).length} repositories done.`);
    }

    let issuesWritten = 0;
    if (config.includeIssues && config.githubUsernames.length) {
      try {
        issuesWritten = await scanIssues(client, config, period, db, progress);
      } catch (error) {
        if (isRateLimitBudgetError(error)) {
          incomplete = true;
          progress(`${(error as Error).message} Skipping the rest of the issue scan.`);
        } else {
          warnings.push(`Issue scan failed: ${(error as Error).message}`);
        }
      }
    }

    let enriched = 0;
    if (config.fetchCommitDetails) {
      const enrichment = await enrichCommits({
        client,
        db,
        config,
        logins: config.githubUsernames,
        log: progress,
      });
      enriched = enrichment.enriched;
      if (enrichment.stoppedEarly) incomplete = true;
    }

    const repositories = new Set(rows.map((r) => r.repository)).size;

    await recordRun(db, {
      periodStart: period.start,
      periodEnd: period.end,
      users: config.githubUsernames,
      displayNames: config.userDisplayNames,
      scope: { organizations: config.organizations, repositories: config.repositories },
      counts: { commits: commitsWritten, issues: issuesWritten, repositories, enriched },
      incomplete,
      message: incomplete ? "Stopped early on the GitHub rate-limit budget." : undefined,
    });

    if (incomplete) {
      warnings.push(
        "The run stopped early on the rate-limit budget, so these numbers are partial. " +
          "Run it again once the quota resets and it will continue where it left off."
      );
    }

    return {
      counts: { commits: commitsWritten, issues: issuesWritten, repositories, enriched },
      period: { start: period.startDay, end: period.endDay },
      users: config.githubUsernames,
      incomplete,
      warnings,
      apiRequests: client.requestCount,
    };
  } finally {
    await close();
  }
}

/**
 * Issues authored by the tracked users in the period.
 *
 * Uses the search API, which indexes issues properly (unlike commits, where
 * search only covers default branches). Search has its own small per-minute
 * quota, which the client rides out.
 */
async function scanIssues(
  client: GitHubClient,
  config: ScanConfig,
  period: { startDay: string; endDay: string },
  db: ReturnType<typeof createPool>["db"],
  progress: (message: string) => void
): Promise<number> {
  const scopes = config.repositories.length
    ? config.repositories.map((r) => `repo:${r}`)
    : config.organizations.map((o) => `org:${o}`);
  if (!scopes.length) return 0;

  const rows = [];
  for (const scope of scopes) {
    for (const user of config.githubUsernames) {
      const query = `${scope} type:issue author:${user} created:${period.startDay}..${period.endDay}`;
      const items = await client.paged<RawIssue>(
        "/search/issues",
        { q: query, advanced_search: "true" },
        config.maxItemsPerSearch
      );
      rows.push(...items.map((i) => normalizeIssue(i, "issue")));
    }
  }

  // The same issue can match several scopes.
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()].filter((r) => r.repository);
  const written = await upsertIssues(db, unique);
  progress(`Stored ${written} issues.`);
  return written;
}
