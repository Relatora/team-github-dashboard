/**
 * Backfill line statistics on stored commits, without a full scan.
 *
 *   npm run enrich
 *   npm run enrich -- --users Relatora --limit 2000
 *
 * Run this after bumping STATS_VERSION, or to fill in statistics for commits a
 * scan stored without them. It is incremental and budget aware: commits already
 * current are skipped, and it stops cleanly when the quota floor is reached,
 * keeping everything it has fetched so far.
 */
import "dotenv/config";
import { GitHubClient, preflight } from "../lib/github/client";
import { enrichCommits } from "../lib/github/enrich";
import { getScanConfig } from "../lib/config";
import { resolveGitHubToken } from "../lib/config/env";
import { createPool } from "../lib/db/pool";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const config = getScanConfig();

  const client = new GitHubClient({
    token: resolveGitHubToken(),
    apiBase: config.githubApiBase,
    minRemaining: config.rateLimitMinRemaining,
    rateLimitAction: config.rateLimitAction,
    log: (m) => console.log(m),
  });

  const check = await preflight(client);
  for (const warning of check.warnings) console.warn(`Warning: ${warning}`);
  console.log(`GitHub quota: ${check.coreRemaining} of ${check.coreLimit} core requests remaining.`);

  const { db, close } = createPool();
  try {
    const users = arg("users");
    const result = await enrichCommits({
      client,
      db,
      config,
      // "*" means every author already in the data, not only the configured roster.
      logins: users && users !== "*" ? users.split(",").map((u) => u.trim()) : undefined,
      limit: arg("limit") ? Number(arg("limit")) : undefined,
      log: (m) => console.log(m),
    });

    console.log(
      `\nExamined ${result.examined}, enriched ${result.enriched}, failed ${result.failed}.`
    );
    process.exit(result.stoppedEarly ? 2 : 0);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
