import type Database from "better-sqlite3";
import type { NewCommitRow } from "@/lib/db/schema";

/**
 * The never-clobber upsert, expressed for SQLite.
 *
 * SQLite (>= 3.35, bundled by better-sqlite3) supports the same
 * `ON CONFLICT ... DO UPDATE SET x = coalesce(excluded.x, table.x)` shape as
 * the Postgres statement in lib/db/repositories/commits.ts - this is not a
 * Postgres-only feature, so the rule is expressed identically, not
 * reimplemented in application code.
 */
const UPSERT_SQL = `
insert into commits (
  sha, repository, message, committed_at, author_login, author_name, author_email,
  category, url, api_url, is_merge,
  additions, deletions, files_changed, additions_raw, deletions_raw, files_changed_raw,
  stats_version, scanned_at
) values (
  @sha, @repository, @message, @committedAt, @authorLogin, @authorName, @authorEmail,
  @category, @url, @apiUrl, @isMerge,
  @additions, @deletions, @filesChanged, @additionsRaw, @deletionsRaw, @filesChangedRaw,
  @statsVersion, datetime('now')
)
on conflict(sha) do update set
  repository = excluded.repository,
  message = excluded.message,
  committed_at = excluded.committed_at,
  author_login = excluded.author_login,
  author_name = excluded.author_name,
  author_email = excluded.author_email,
  category = excluded.category,
  url = excluded.url,
  api_url = excluded.api_url,
  is_merge = excluded.is_merge,
  additions = coalesce(excluded.additions, commits.additions),
  deletions = coalesce(excluded.deletions, commits.deletions),
  files_changed = coalesce(excluded.files_changed, commits.files_changed),
  additions_raw = coalesce(excluded.additions_raw, commits.additions_raw),
  deletions_raw = coalesce(excluded.deletions_raw, commits.deletions_raw),
  files_changed_raw = coalesce(excluded.files_changed_raw, commits.files_changed_raw),
  stats_version = coalesce(excluded.stats_version, commits.stats_version),
  scanned_at = datetime('now')
`;

export function upsertCommits(db: Database.Database, rows: NewCommitRow[]): number {
  if (!rows.length) return 0;

  const stmt = db.prepare(UPSERT_SQL);
  const runAll = db.transaction((batch: NewCommitRow[]) => {
    for (const r of batch) {
      stmt.run({
        sha: r.sha,
        repository: r.repository ?? "",
        message: r.message ?? "",
        committedAt: r.committedAt ? new Date(r.committedAt).toISOString() : null,
        authorLogin: r.authorLogin ?? "",
        authorName: r.authorName ?? "",
        authorEmail: r.authorEmail ?? "",
        category: r.category ?? "Uncategorized",
        url: r.url ?? "",
        apiUrl: r.apiUrl ?? "",
        isMerge: r.isMerge ? 1 : 0,
        additions: r.additions ?? null,
        deletions: r.deletions ?? null,
        filesChanged: r.filesChanged ?? null,
        additionsRaw: r.additionsRaw ?? null,
        deletionsRaw: r.deletionsRaw ?? null,
        filesChangedRaw: r.filesChangedRaw ?? null,
        statsVersion: r.statsVersion ?? null,
      });
    }
  });
  runAll(rows);
  return rows.length;
}

export function getCommitForVerification(db: Database.Database, sha: string) {
  const row = db
    .prepare(
      `select message, additions, deletions, files_changed as filesChanged,
              additions_raw as additionsRaw, stats_version as statsVersion
       from commits where sha = ?`
    )
    .get(sha) as
    | {
        message: string;
        additions: number | null;
        deletions: number | null;
        filesChanged: number | null;
        additionsRaw: number | null;
        statsVersion: number | null;
      }
    | undefined;
  return row ?? null;
}

export function deleteCommit(db: Database.Database, sha: string): void {
  db.prepare(`delete from commits where sha = ?`).run(sha);
}
