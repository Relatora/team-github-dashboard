import type Database from "better-sqlite3";
import { resolvePeriodFilters, type PeriodFilters } from "@/lib/metrics/period";
import { renderMarkdown, type ReportCommit, type ReportData } from "@/lib/report/markdown";
import type { CalcMode } from "@/lib/metrics/aggregate";

/**
 * The narrative report, built from the demo SQLite dataset.
 *
 * A sibling of lib/report/build.ts, not a wrap of it: that file queries
 * Postgres directly via Drizzle and is deliberately outside lib/store (see
 * lib/store/types.ts), so there is nothing to share except the pure Markdown
 * renderer, which both call.
 */

export class NoDemoDataError extends Error {
  constructor() {
    super("No demo commits match the requested users and period.");
    this.name = "NoDemoDataError";
  }
}

export type DemoReportRequest = PeriodFilters & {
  users: string[];
  audience?: "leadership" | "technical";
  calc?: CalcMode;
  showRemoved?: boolean;
};

/**
 * Matches the PEOPLE list in scripts/seed-demo.ts. Duplicated rather than
 * imported: that script owns the synthetic data, this only owns how it is
 * labelled, and importing across the scripts/lib boundary for four names is
 * not worth the coupling.
 */
export const DEMO_DISPLAY_NAMES: Record<string, string> = {
  "demo-avery": "Avery Lin",
  "demo-jordan": "Jordan Okafor",
  "demo-sam": "Sam Petrov",
  "demo-riley": "Riley Chen",
};

export function buildDemoReport(db: Database.Database, request: DemoReportRequest): string {
  const audience = request.audience === "technical" ? "technical" : "leadership";
  const calc: CalcMode = request.calc === "raw" ? "raw" : "cleaned";
  const showRemoved = request.showRemoved ?? true;

  const logins = request.users.map((u) => u.trim().toLowerCase()).filter(Boolean);
  if (!logins.length) throw new NoDemoDataError();

  const period = resolvePeriodFilters(request);
  const addCol = calc === "raw" ? "additions_raw" : "additions";
  const delCol = calc === "raw" ? "deletions_raw" : "deletions";
  const filesCol = calc === "raw" ? "files_changed_raw" : "files_changed";

  const placeholders = logins.map(() => "?").join(",");
  const params: unknown[] = [...logins];
  let where = `lower(author_login) in (${placeholders})`;
  if (period) {
    where += " and committed_at >= ? and committed_at < ?";
    params.push(period.start.toISOString(), period.end.toISOString());
  }

  const rows = db
    .prepare(
      `select sha, repository, message, committed_at as committedAt, category, url,
              ${addCol} as additions, ${delCol} as deletions, ${filesCol} as filesChanged
       from commits where ${where} order by committed_at asc`
    )
    .all(...params) as Array<{
    sha: string;
    repository: string;
    message: string;
    committedAt: string | null;
    category: string;
    url: string;
    additions: number | null;
    deletions: number | null;
    filesChanged: number | null;
  }>;

  if (!rows.length) throw new NoDemoDataError();

  let issueWhere = `type = 'issue' and lower(author_login) in (${placeholders})`;
  const issueParams: unknown[] = [...logins];
  if (period) {
    issueWhere += " and created_at >= ? and created_at < ?";
    issueParams.push(period.start.toISOString(), period.end.toISOString());
  }
  const issueRow = db.prepare(`select count(*) as n from issues where ${issueWhere}`).get(...issueParams) as
    | { n: number }
    | undefined;

  const commitData: ReportCommit[] = rows.map((r) => ({
    sha: r.sha,
    repository: r.repository,
    message: r.message,
    day: r.committedAt ? r.committedAt.slice(0, 10) : "",
    category: r.category,
    url: r.url,
    additions: r.additions,
    deletions: r.deletions,
    filesChanged: r.filesChanged,
  }));

  const data: ReportData = {
    commits: commitData,
    issueCount: issueRow?.n ?? 0,
    users: request.users,
    displayNames: DEMO_DISPLAY_NAMES,
    periodStart: period?.startDay ?? commitData[0]?.day ?? "",
    periodEnd: period?.endDay ?? commitData[commitData.length - 1]?.day ?? "",
    audience,
    calc,
    showRemoved,
    includeIssues: true,
    notes: ["This report is built from synthetic demo data, not a real organization."],
  };

  return renderMarkdown(data);
}
