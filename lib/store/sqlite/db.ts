import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The SQLite schema, a deliberately smaller cut of lib/db/schema.ts: only the
 * three tables the demo route and the never-clobber verification actually
 * touch (commits, issues, runs). There is no tracked_users, scan_schedule,
 * repo_branch_cache, secrets, or users table here - a static demo dataset has
 * no scheduler, no discovery cache, and no accounts to protect.
 */
const DDL = `
create table if not exists commits (
  sha text primary key,
  repository text not null default '',
  message text not null default '',
  committed_at text,
  author_login text not null default '',
  author_name text not null default '',
  author_email text not null default '',
  category text not null default 'Uncategorized',
  url text not null default '',
  api_url text not null default '',
  is_merge integer not null default 0,
  additions integer,
  deletions integer,
  files_changed integer,
  additions_raw integer,
  deletions_raw integer,
  files_changed_raw integer,
  stats_version integer,
  scanned_at text not null default (datetime('now'))
);
create index if not exists commits_author_idx on commits(author_login);
create index if not exists commits_repository_idx on commits(repository);
create index if not exists commits_category_idx on commits(category);

create table if not exists issues (
  id text primary key,
  type text not null default 'issue',
  number integer,
  title text not null default '',
  state text not null default '',
  repository text not null default '',
  author_login text not null default '',
  created_at text,
  updated_at text,
  closed_at text,
  labels text not null default '',
  url text not null default ''
);
create index if not exists issues_author_idx on issues(author_login);
create index if not exists issues_type_idx on issues(type);

create table if not exists runs (
  id integer primary key autoincrement,
  generated_at text not null default (datetime('now')),
  period_start text,
  period_end text,
  users text not null default '[]',
  display_names text not null default '{}',
  scope text not null default '{}',
  counts text not null default '{}',
  incomplete integer not null default 0,
  message text
);
create index if not exists runs_generated_at_idx on runs(generated_at);
`;

const cache = new Map<string, Database.Database>();

/** Opens (and creates, if needed) the SQLite file at `filePath`, cached per path. */
export function openDemoDb(filePath: string): Database.Database {
  const cached = cache.get(filePath);
  if (cached) return cached;

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(DDL);
  cache.set(filePath, db);
  return db;
}
