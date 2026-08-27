import { sql } from "drizzle-orm";
import { commits, type NewCommitRow } from "@/lib/db/schema";
import { inList } from "@/lib/db/sql-helpers";
import type { PooledDatabase } from "@/lib/db/pool";

/**
 * Persisting commits, and the one invariant most likely to be broken by a
 * careless change.
 *
 * THE NEVER-CLOBBER RULE
 *
 * Enrichment costs one API call per commit. A plain scan does not pay that, so
 * it has no line statistics to write. If such a scan overwrites the columns
 * anyway, thousands of correct numbers are destroyed and nothing reports an
 * error: the dashboard simply starts showing "Cleaned: 0" and the only way to
 * discover it is to query the database by hand. This shipped broken once in
 * the Python tool, where the protection depended on remembering to omit fields
 * from the update document.
 *
 * Here it is written into the statement. Every statistic column is coalesced,
 * so an absent value can never replace a present one. Deleting a COALESCE
 * reintroduces the bug; there is no way to reintroduce it by forgetting.
 */

/** Postgres caps a statement at 65535 parameters; this stays well under with 19 columns. */
const BATCH_SIZE = 500;

export async function upsertCommits(db: PooledDatabase, rows: NewCommitRow[]): Promise<number> {
  if (!rows.length) return 0;

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await db
      .insert(commits)
      .values(batch)
      .onConflictDoUpdate({
        target: commits.sha,
        set: {
          // Descriptive columns always take the newer value: a commit message
          // can be amended and a repository renamed.
          repository: sql`excluded.repository`,
          message: sql`excluded.message`,
          committedAt: sql`excluded.committed_at`,
          authorLogin: sql`excluded.author_login`,
          authorName: sql`excluded.author_name`,
          authorEmail: sql`excluded.author_email`,
          category: sql`excluded.category`,
          url: sql`excluded.url`,
          apiUrl: sql`excluded.api_url`,
          isMerge: sql`excluded.is_merge`,

          // Statistics never regress to NULL. See the note at the top: this is
          // the whole protection, and each line is load bearing.
          additions: sql`coalesce(excluded.additions, ${commits.additions})`,
          deletions: sql`coalesce(excluded.deletions, ${commits.deletions})`,
          filesChanged: sql`coalesce(excluded.files_changed, ${commits.filesChanged})`,
          additionsRaw: sql`coalesce(excluded.additions_raw, ${commits.additionsRaw})`,
          deletionsRaw: sql`coalesce(excluded.deletions_raw, ${commits.deletionsRaw})`,
          filesChangedRaw: sql`coalesce(excluded.files_changed_raw, ${commits.filesChangedRaw})`,
          // The version must move with the statistics it describes, or a stale
          // version would make enrichment recompute rows that are already current.
          statsVersion: sql`coalesce(excluded.stats_version, ${commits.statsVersion})`,

          scannedAt: sql`now()`,
        },
      });

    written += batch.length;
  }

  return written;
}

/**
 * SHAs already carrying statistics at the current version.
 *
 * Enrichment skips these, which is the single largest saving on a repeat scan:
 * without it, refreshing a wide date range re-fetches detail for thousands of
 * commits that have not changed.
 */
export async function findEnrichedShas(
  db: PooledDatabase,
  shas: string[],
  statsVersion: number
): Promise<Set<string>> {
  if (!shas.length) return new Set();

  const found = new Set<string>();
  for (let i = 0; i < shas.length; i += 1000) {
    const batch = shas.slice(i, i + 1000);
    const rows = await db.execute<{ sha: string }>(sql`
      select sha from ${commits}
      where ${inList(sql`sha`, batch)}
        and stats_version = ${statsVersion}
        and additions is not null
    `);
    for (const row of rows.rows) found.add(row.sha);
  }
  return found;
}

/**
 * Commits still needing statistics, oldest first.
 *
 * Matches rows never enriched and rows enriched under an older STATS_VERSION,
 * which is how a version bump forces a recompute.
 */
export async function findCommitsNeedingStats(
  db: PooledDatabase,
  statsVersion: number,
  options: { limit?: number; logins?: string[] } = {}
): Promise<Array<{ sha: string; apiUrl: string }>> {
  const limit = options.limit ?? 5000;
  const logins = options.logins?.length ? options.logins.map((l) => l.toLowerCase()) : null;

  const rows = await db.execute<{ sha: string; api_url: string }>(sql`
    select sha, api_url from ${commits}
    where api_url <> ''
      and (stats_version is null or stats_version < ${statsVersion} or additions is null)
      ${logins ? sql`and ${inList(sql`lower(author_login)`, logins)}` : sql``}
    order by committed_at desc nulls last
    limit ${limit}
  `);

  return rows.rows.map((r) => ({ sha: r.sha, apiUrl: r.api_url }));
}

/** Write statistics onto rows that already exist. Used by the enrichment sweep. */
export async function updateCommitStats(
  db: PooledDatabase,
  updates: Array<{
    sha: string;
    additions: number;
    deletions: number;
    filesChanged: number;
    additionsRaw: number;
    deletionsRaw: number;
    filesChangedRaw: number;
    isMerge: boolean;
    statsVersion: number;
  }>
): Promise<number> {
  if (!updates.length) return 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    // One statement per batch via a values list, rather than one UPDATE per
    // commit. Enrichment can touch thousands of rows in a run.
    const values = sql.join(
      batch.map(
        (u) =>
          sql`(${u.sha}, ${u.additions}::int, ${u.deletions}::int, ${u.filesChanged}::int,
               ${u.additionsRaw}::int, ${u.deletionsRaw}::int, ${u.filesChangedRaw}::int,
               ${u.isMerge}::boolean, ${u.statsVersion}::int)`
      ),
      sql`, `
    );

    await db.execute(sql`
      update ${commits} as c set
        additions = v.additions,
        deletions = v.deletions,
        files_changed = v.files_changed,
        additions_raw = v.additions_raw,
        deletions_raw = v.deletions_raw,
        files_changed_raw = v.files_changed_raw,
        is_merge = v.is_merge,
        stats_version = v.stats_version
      from (values ${values}) as v(sha, additions, deletions, files_changed,
                                   additions_raw, deletions_raw, files_changed_raw,
                                   is_merge, stats_version)
      where c.sha = v.sha
    `);
  }

  return updates.length;
}
