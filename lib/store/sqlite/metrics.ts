import type Database from "better-sqlite3";
import { resolvePeriodFilters } from "@/lib/metrics/period";
import { NO_USERS } from "@/lib/metrics/aggregate";
import type { CalcMode, CountRow, Metrics, MetricsQuery, RosterUser, TimeRow } from "@/lib/metrics/aggregate";

/**
 * The dashboard aggregation, reimplemented for SQLite.
 *
 * Deliberately NOT a port of lib/metrics/aggregate.ts's SQL: SQLite has no
 * FULL OUTER JOIN before 3.39 and a different date-extraction dialect
 * (strftime, not extract(... from ...)). Same query shape, same input, same
 * output - the divergence in implementation is what actually proves the
 * storage interface is a real abstraction, not two functions sharing a name.
 */

function statColumns(calc: CalcMode) {
  return calc === "raw"
    ? { add: "additions_raw", del: "deletions_raw", files: "files_changed_raw" }
    : { add: "additions", del: "deletions", files: "files_changed" };
}

const EMPTY_KPIS = {
  commits: 0,
  additions: 0,
  deletions: 0,
  files: 0,
  repos: 0,
  contributors: 0,
  issues: 0,
};

export function getMetrics(db: Database.Database, query: MetricsQuery): Metrics {
  const calc: CalcMode = query.calc === "raw" ? "raw" : "cleaned";
  const stat = statColumns(calc);
  const period = resolvePeriodFilters(query);

  const logins = query.users.map((u) => u.trim().toLowerCase()).filter(Boolean);
  const noUsers = !logins.length || logins.includes(NO_USERS);
  if (noUsers) {
    return {
      users: query.users,
      calc,
      kpis: EMPTY_KPIS,
      commitsOverTime: [],
      linesOverTime: [],
      byRepo: [],
      linesByRepo: [],
      byAuthor: [],
      linesByAuthor: [],
      byCategory: [],
    };
  }

  const placeholders = logins.map(() => "?").join(",");
  const params: unknown[] = [...logins];
  let where = `lower(author_login) in (${placeholders})`;
  if (query.repo) {
    where += " and repository = ?";
    params.push(query.repo);
  }
  if (period) {
    where += " and committed_at >= ? and committed_at < ?";
    params.push(period.start.toISOString(), period.end.toISOString());
  }

  const groupCount = (expr: string, aggregate: string): CountRow[] => {
    const rows = db
      .prepare(`select ${expr} as id, ${aggregate} as count from commits where ${where} group by ${expr} order by count desc`)
      .all(...params) as { id: string; count: number }[];
    return rows.map((r) => ({ _id: r.id, count: Number(r.count) }));
  };

  const monthly = (aggregate: string): TimeRow[] => {
    const rows = db
      .prepare(
        `select cast(strftime('%Y', committed_at) as integer) as year,
                cast(strftime('%m', committed_at) as integer) as month,
                ${aggregate} as count
         from commits
         where ${where} and committed_at is not null
         group by year, month
         order by year, month`
      )
      .all(...params) as { year: number; month: number; count: number }[];
    return rows.map((r) => ({ _id: { year: r.year, month: r.month }, count: Number(r.count) }));
  };

  const kpi = db
    .prepare(
      `select count(*) as commits,
              coalesce(sum(${stat.add}), 0) as additions,
              coalesce(sum(${stat.del}), 0) as deletions,
              coalesce(sum(${stat.files}), 0) as files,
              count(distinct repository) as repos,
              count(distinct author_login) as contributors
       from commits where ${where}`
    )
    .get(...params) as
    | { commits: number; additions: number; deletions: number; files: number; repos: number; contributors: number }
    | undefined;

  let issueWhere = `type = 'issue' and lower(author_login) in (${placeholders})`;
  const issueParams: unknown[] = [...logins];
  if (period) {
    issueWhere += " and created_at >= ? and created_at < ?";
    issueParams.push(period.start.toISOString(), period.end.toISOString());
  }
  const issueRow = db.prepare(`select count(*) as n from issues where ${issueWhere}`).get(...issueParams) as
    | { n: number }
    | undefined;

  return {
    users: query.users,
    calc,
    kpis: {
      commits: Number(kpi?.commits ?? 0),
      additions: Number(kpi?.additions ?? 0),
      deletions: Number(kpi?.deletions ?? 0),
      files: Number(kpi?.files ?? 0),
      repos: Number(kpi?.repos ?? 0),
      contributors: Number(kpi?.contributors ?? 0),
      issues: Number(issueRow?.n ?? 0),
    },
    commitsOverTime: monthly("count(*)"),
    linesOverTime: monthly(`coalesce(sum(${stat.add}), 0)`),
    byRepo: groupCount("repository", "count(*)"),
    linesByRepo: groupCount("repository", `coalesce(sum(${stat.add}), 0)`),
    byAuthor: groupCount("author_login", "count(*)"),
    linesByAuthor: groupCount("author_login", `coalesce(sum(${stat.add}), 0)`),
    byCategory: groupCount("coalesce(nullif(category, ''), 'Uncategorized')", "count(*)"),
  };
}

/**
 * The roster, for SQLite: purely commit authors.
 *
 * A demo dataset has no tracked_users table and nobody to add before their
 * first scan, so there is no union to compute and `tracked`/`neverScanned`
 * are always false - a deliberate simplification, not a missing feature.
 */
export function getRoster(db: Database.Database, displayNames: Record<string, string> = {}): RosterUser[] {
  const rows = db
    .prepare(
      `select author_login as handle,
              (
                select author_name from commits c2
                where c2.author_login = c1.author_login
                order by c2.committed_at desc
                limit 1
              ) as name,
              count(*) as count
       from commits c1
       where author_login <> ''
       group by author_login
       order by count desc, handle asc`
    )
    .all() as { handle: string; name: string | null; count: number }[];

  const curated = new Map(Object.entries(displayNames).map(([h, n]) => [h.toLowerCase(), n]));

  return rows.map((r) => ({
    handle: r.handle,
    name: curated.get(r.handle.toLowerCase()) || r.name || r.handle,
    count: Number(r.count),
    tracked: false,
    neverScanned: false,
  }));
}
