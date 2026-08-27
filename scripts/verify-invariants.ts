/**
 * Verify the never-clobber invariant against a live database.
 *
 *   npm run verify-invariants
 *
 * Writes an enriched commit, then re-upserts the same row with NO statistics,
 * exactly as a scan that did not fetch per-commit detail would. The numbers
 * must survive while the descriptive fields still update.
 *
 * This needs a real database, so it cannot run in CI alongside the parity
 * checks. Run it after any change to the upsert in
 * lib/db/repositories/commits.ts, which is the one place where a plausible
 * looking edit destroys data silently. Use a throwaway database or a Neon
 * branch; the script cleans up after itself, but it does write.
 *
 * Exits 0 when the invariant holds, 1 when it does not.
 */
import "../lib/config/load-env";
import { sql } from "drizzle-orm";
import { createPool } from "../lib/db/pool";
import { upsertCommits } from "../lib/db/repositories/commits";

const SHA = "cafebabe00000000000000000000000000000001";

async function main() {
  const { db, close } = createPool();
  try {
    // 1. An enriched commit, as enrichment would leave it.
    await upsertCommits(db, [{
      sha: SHA, repository: "example-org/invariant-test", message: "add the thing",
      committedAt: new Date("2026-08-15T12:00:00Z"), authorLogin: "demo-avery",
      authorName: "Avery Lin", authorEmail: "avery@example.com",
      category: "Features & additions", url: "", apiUrl: "https://api.example/1",
      isMerge: false,
      additions: 1234, deletions: 567, filesChanged: 89,
      additionsRaw: 9999, deletionsRaw: 8888, filesChangedRaw: 777,
      statsVersion: 3,
    }]);

    const before = await db.execute<Record<string, number>>(
      sql`select additions, deletions, files_changed, additions_raw, stats_version
          from commits where sha = ${SHA}`);
    console.log("after enrichment:      ", before.rows[0]);

    // 2. The same commit from a plain scan: message changed, no statistics.
    await upsertCommits(db, [{
      sha: SHA, repository: "example-org/invariant-test", message: "add the thing (amended)",
      committedAt: new Date("2026-08-15T12:00:00Z"), authorLogin: "demo-avery",
      authorName: "Avery Lin", authorEmail: "avery@example.com",
      category: "Features & additions", url: "", apiUrl: "https://api.example/1",
      isMerge: false,
      // No statistic fields at all, exactly as toCommitRow leaves them.
    }]);

    const after = await db.execute<Record<string, number | string>>(
      sql`select message, additions, deletions, files_changed, additions_raw, stats_version
          from commits where sha = ${SHA}`);
    console.log("after a stats-free scan:", after.rows[0]);

    const row = after.rows[0];
    const statsSurvived =
      row.additions === 1234 && row.deletions === 567 &&
      row.files_changed === 89 && row.additions_raw === 9999 && row.stats_version === 3;
    const messageUpdated = row.message === "add the thing (amended)";

    console.log("\nstatistics survived: ", statsSurvived);
    console.log("message still updated:", messageUpdated);

    await db.execute(sql`delete from commits where sha = ${SHA}`);
    process.exit(statsSurvived && messageUpdated ? 0 : 1);
  } finally {
    await close();
  }
}
main();
