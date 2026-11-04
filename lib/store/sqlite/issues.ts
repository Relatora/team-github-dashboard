import type Database from "better-sqlite3";
import type { ItemRow } from "@/lib/db/repositories/items";

const UPSERT_SQL = `
insert into issues (
  id, type, number, title, state, repository, author_login,
  created_at, updated_at, closed_at, labels, url
) values (
  @id, @type, @number, @title, @state, @repository, @authorLogin,
  @createdAt, @updatedAt, @closedAt, @labels, @url
)
on conflict(id) do update set
  type = excluded.type,
  title = excluded.title,
  state = excluded.state,
  -- Never let a later ingest blank out an author that was captured once,
  -- mirroring the nullif(excluded.author_login, '') rule in
  -- lib/db/repositories/items.ts.
  author_login = coalesce(nullif(excluded.author_login, ''), issues.author_login),
  updated_at = excluded.updated_at,
  closed_at = excluded.closed_at,
  labels = excluded.labels
`;

export function upsertIssues(db: Database.Database, rows: ItemRow[]): number {
  if (!rows.length) return 0;

  const stmt = db.prepare(UPSERT_SQL);
  const runAll = db.transaction((batch: ItemRow[]) => {
    for (const r of batch) {
      stmt.run({
        id: r.id,
        type: r.type,
        number: r.number ?? null,
        title: r.title ?? "",
        state: r.state ?? "",
        repository: r.repository ?? "",
        authorLogin: r.authorLogin ?? "",
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
        closedAt: r.closedAt ? r.closedAt.toISOString() : null,
        labels: r.labels ?? "",
        url: r.url ?? "",
      });
    }
  });
  runAll(rows);
  return rows.length;
}
