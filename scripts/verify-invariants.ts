/**
 * Verify the never-clobber invariant against a live store.
 *
 *   npm run verify-invariants                  # Postgres (default)
 *   npm run verify-invariants -- --adapter sqlite
 *
 * Writes an enriched commit, then re-upserts the same row with NO statistics,
 * exactly as a scan that did not fetch per-commit detail would. The numbers
 * must survive while the descriptive fields still update.
 *
 * Runs through lib/store, not lib/db/repositories/commits.ts directly, so
 * this is also the proof that the storage interface (lib/store/types.ts) is
 * genuinely portable: the same test, unchanged, against two different
 * database engines. `--adapter sqlite` writes into the demo dataset
 * (lib/store/sqlite, data/demo.sqlite) and cleans up after itself, same as
 * the Postgres path.
 *
 * The Postgres path needs a real database, so it cannot run in CI alongside
 * the parity checks. Run it after any change to the upsert in
 * lib/db/repositories/commits.ts or lib/store/sqlite/commits.ts, which are
 * the two places a plausible looking edit destroys data silently. Use a
 * throwaway database or a Neon branch for Postgres; the script cleans up
 * after itself, but it does write.
 *
 * Exits 0 when the invariant holds, 1 when it does not.
 */
import "../lib/config/load-env";
import { getStore, getDemoStore } from "../lib/store";

const SHA = "cafebabe00000000000000000000000000000001";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const adapter = arg("adapter") === "sqlite" ? "sqlite" : "postgres";
  const store = adapter === "sqlite" ? getDemoStore() : getStore();
  console.log(`Adapter: ${adapter}`);

  // 1. An enriched commit, as enrichment would leave it.
  await store.upsertCommits([{
    sha: SHA, repository: "example-org/invariant-test", message: "add the thing",
    committedAt: new Date("2026-08-15T12:00:00Z"), authorLogin: "demo-avery",
    authorName: "Avery Lin", authorEmail: "avery@example.com",
    category: "Features & additions", url: "", apiUrl: "https://api.example/1",
    isMerge: false,
    additions: 1234, deletions: 567, filesChanged: 89,
    additionsRaw: 9999, deletionsRaw: 8888, filesChangedRaw: 777,
    statsVersion: 3,
  }]);

  const before = await store.getCommitForVerification(SHA);
  console.log("after enrichment:      ", before);

  // 2. The same commit from a plain scan: message changed, no statistics.
  await store.upsertCommits([{
    sha: SHA, repository: "example-org/invariant-test", message: "add the thing (amended)",
    committedAt: new Date("2026-08-15T12:00:00Z"), authorLogin: "demo-avery",
    authorName: "Avery Lin", authorEmail: "avery@example.com",
    category: "Features & additions", url: "", apiUrl: "https://api.example/1",
    isMerge: false,
    // No statistic fields at all, exactly as toCommitRow leaves them.
  }]);

  const after = await store.getCommitForVerification(SHA);
  console.log("after a stats-free scan:", after);

  const statsSurvived =
    after?.additions === 1234 && after?.deletions === 567 &&
    after?.filesChanged === 89 && after?.additionsRaw === 9999 && after?.statsVersion === 3;
  const messageUpdated = after?.message === "add the thing (amended)";

  console.log("\nstatistics survived: ", statsSurvived);
  console.log("message still updated:", messageUpdated);

  await store.deleteCommit(SHA);
  process.exit(statsSurvived && messageUpdated ? 0 : 1);
}
main();
