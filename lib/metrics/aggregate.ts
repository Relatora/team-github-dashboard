import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { resolvePeriodFilters, type PeriodFilters } from "./period";

/**
 * The dashboard aggregation.
 *
 * The source was a single MongoDB $facet with seven branches
 * (GitHubController.js:102-177). In Postgres it becomes seven small GROUP BY
 * queries sharing one WHERE clause, issued together. The single-pass advantage
 * of $facet does not matter at this row count, and separate statements are far
 * easier to read, index, and reason about individually.
 *
 * Translation notes:
 *   $group by {year, month}   ->  date_trunc('month', committed_at)
 *   $addToSet then $size      ->  count(distinct ...)
 *   $ifNull on the stat field ->  coalesce, so unenriched commits count as 0
 */

/** Cleaned (default) or raw line statistics. */
export type CalcMode = "cleaned" | "raw";

export type MetricsQuery = PeriodFilters & {
  users: string[];
  repo?: string | null;
  calc?: CalcMode;
};

export type CountRow = { _id: string; count: number };
export type TimeRow = { _id: { year: number; month: number }; count: number };

export type Metrics = {
  users: string[];
  calc: CalcMode;
  kpis: {
    commits: number;
    additions: number;
    deletions: number;
    files: number;
    repos: number;
    contributors: number;
    issues: number;
  };
  commitsOverTime: TimeRow[];
  linesOverTime: TimeRow[];
  byRepo: CountRow[];
  linesByRepo: CountRow[];
  byAuthor: CountRow[];
  linesByAuthor: CountRow[];
  byCategory: CountRow[];
};

/**
 * A sentinel meaning "the user deselected everyone".
 *
 * Without it an empty selection reads as "no filter" and the dashboard shows
 * everybody, which is the opposite of what was asked for. Carried over from the
 * source client for the same reason.
 */
export const NO_USERS = "__none__";

const EMPTY_KPIS = {
  commits: 0,
  additions: 0,
  deletions: 0,
  files: 0,
  repos: 0,
  contributors: 0,
  issues: 0,
};

/** Which columns `calc` selects. Cleaned is the default everywhere. */
function statColumns(calc: CalcMode) {
  return calc === "raw"
    ? { add: sql`additions_raw`, del: sql`deletions_raw`, files: sql`files_changed_raw` }
    : { add: sql`additions`, del: sql`deletions`, files: sql`files_changed` };
}

export async function getMetrics(query: MetricsQuery): Promise<Metrics> {
  const db = getDb();
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

  // One WHERE clause, reused by every query below so they cannot disagree.
  const conditions: SQL[] = [sql`lower(author_login) = any(${logins})`];
  if (query.repo) conditions.push(sql`repository = ${query.repo}`);
  if (period) {
    conditions.push(sql`committed_at >= ${period.start} and committed_at < ${period.end}`);
  }
  const where = sql.join(conditions, sql` and `);

  /** [{_id, count}] for a grouping expression. */
  const groupCount = async (expression: SQL, aggregate: SQL): Promise<CountRow[]> => {
    const result = await db.execute<{ id: string; count: number }>(sql`
      select ${expression} as id, ${aggregate} as count
      from commits
      where ${where}
      group by ${expression}
      order by count desc
    `);
    return result.rows.map((r) => ({ _id: r.id, count: Number(r.count) }));
  };

  /** [{_id:{year,month}, count}] ordered chronologically. */
  const monthly = async (aggregate: SQL): Promise<TimeRow[]> => {
    const result = await db.execute<{ year: number; month: number; count: number }>(sql`
      select
        extract(year from committed_at)::int as year,
        extract(month from committed_at)::int as month,
        ${aggregate} as count
      from commits
      where ${where} and committed_at is not null
      group by 1, 2
      order by 1, 2
    `);
    return result.rows.map((r) => ({
      _id: { year: Number(r.year), month: Number(r.month) },
      count: Number(r.count),
    }));
  };

  const kpiQuery = db.execute<{
    commits: number;
    additions: number;
    deletions: number;
    files: number;
    repos: number;
    contributors: number;
  }>(sql`
    select
      count(*)::int as commits,
      coalesce(sum(${stat.add}), 0)::int as additions,
      coalesce(sum(${stat.del}), 0)::int as deletions,
      coalesce(sum(${stat.files}), 0)::int as files,
      count(distinct repository)::int as repos,
      count(distinct author_login)::int as contributors
    from commits
    where ${where}
  `);

  /**
   * Issues are counted separately because they are not commits and live in
   * their own table. Rows whose author was never captured have an empty login
   * and are excluded rather than counted for everyone.
   */
  const issueConditions: SQL[] = [
    sql`type = 'issue'`,
    sql`lower(author_login) = any(${logins})`,
  ];
  if (period) {
    issueConditions.push(sql`created_at >= ${period.start} and created_at < ${period.end}`);
  }
  const issueQuery = db.execute<{ n: number }>(sql`
    select count(*)::int as n from issues where ${sql.join(issueConditions, sql` and `)}
  `);

  const [
    kpiResult,
    issueResult,
    commitsOverTime,
    linesOverTime,
    byRepo,
    linesByRepo,
    byAuthor,
    linesByAuthor,
    byCategory,
  ] = await Promise.all([
    kpiQuery,
    issueQuery,
    monthly(sql`count(*)::int`),
    monthly(sql`coalesce(sum(${stat.add}), 0)::int`),
    groupCount(sql`repository`, sql`count(*)::int`),
    groupCount(sql`repository`, sql`coalesce(sum(${stat.add}), 0)::int`),
    groupCount(sql`author_login`, sql`count(*)::int`),
    groupCount(sql`author_login`, sql`coalesce(sum(${stat.add}), 0)::int`),
    groupCount(sql`coalesce(nullif(category, ''), 'Uncategorized')`, sql`count(*)::int`),
  ]);

  const kpis = kpiResult.rows[0] ?? EMPTY_KPIS;

  return {
    users: query.users,
    calc,
    kpis: {
      commits: Number(kpis.commits ?? 0),
      additions: Number(kpis.additions ?? 0),
      deletions: Number(kpis.deletions ?? 0),
      files: Number(kpis.files ?? 0),
      repos: Number(kpis.repos ?? 0),
      contributors: Number(kpis.contributors ?? 0),
      issues: Number(issueResult.rows[0]?.n ?? 0),
    },
    commitsOverTime,
    linesOverTime,
    byRepo,
    linesByRepo,
    byAuthor,
    linesByAuthor,
    byCategory,
  };
}

/**
 * Distinct commit authors present in the data, with a display name and count.
 *
 * The roster is dynamic rather than configured, so someone who appears in the
 * data becomes selectable without a config change. Names resolve in order:
 * curated display names from the most recent run, then the git author name,
 * then the handle itself.
 */
export async function getUsers(displayNames: Record<string, string> = {}) {
  const result = await getDb().execute<{ handle: string; name: string; count: number }>(sql`
    select
      author_login as handle,
      (array_agg(author_name order by committed_at desc nulls last))[1] as name,
      count(*)::int as count
    from commits
    where author_login <> ''
    group by author_login
    order by count desc
  `);

  const curated = new Map(
    Object.entries(displayNames).map(([handle, name]) => [handle.toLowerCase(), name])
  );

  return result.rows.map((row) => ({
    handle: row.handle,
    name: curated.get(row.handle.toLowerCase()) || row.name || row.handle,
    count: Number(row.count),
  }));
}
