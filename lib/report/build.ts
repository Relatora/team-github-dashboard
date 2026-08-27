import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { commits, issues } from "@/lib/db/schema";
import { resolvePeriodFilters, type PeriodFilters } from "@/lib/metrics/period";
import { renderMarkdown, type ReportData, type ReportCommit } from "./markdown";
import { getScanConfig } from "@/lib/config";
import type { CalcMode } from "@/lib/metrics/aggregate";

/**
 * Build the narrative report from stored data. No GitHub calls.
 *
 * Ported from build_report_from_mongo in github_work_report.py.
 */

/**
 * Thrown when nothing matches the requested scope, so the caller can offer a
 * scan rather than showing an error.
 *
 * Commits are the user-attributable core: if none match, the scope is empty
 * even when unrelated issues happen to fall inside the date range.
 */
export class NoDataError extends Error {
  constructor() {
    super("No stored commits match the requested users and period.");
    this.name = "NoDataError";
  }
}

export type ReportRequest = PeriodFilters & {
  users: string[];
  audience?: "leadership" | "technical";
  calc?: CalcMode;
  showRemoved?: boolean;
};

export async function buildReport(request: ReportRequest): Promise<string> {
  const config = getScanConfig();
  const db = getDb();

  const audience = request.audience === "technical" ? "technical" : "leadership";
  const calc: CalcMode = request.calc === "raw" ? "raw" : "cleaned";
  const showRemoved = request.showRemoved ?? true;

  const logins = request.users.map((u) => u.trim().toLowerCase()).filter(Boolean);
  if (!logins.length) throw new NoDataError();

  const period = resolvePeriodFilters(request);

  const conditions = [sql`lower(${commits.authorLogin}) in ${logins}`];
  if (period) {
    conditions.push(gte(commits.committedAt, period.start), lt(commits.committedAt, period.end));
  }

  // Select the requested statistic set here, so the renderer never has to know
  // which mode it is in.
  const rows = await db
    .select({
      sha: commits.sha,
      repository: commits.repository,
      message: commits.message,
      committedAt: commits.committedAt,
      category: commits.category,
      url: commits.url,
      additions: calc === "raw" ? commits.additionsRaw : commits.additions,
      deletions: calc === "raw" ? commits.deletionsRaw : commits.deletions,
      filesChanged: calc === "raw" ? commits.filesChangedRaw : commits.filesChanged,
    })
    .from(commits)
    .where(and(...conditions))
    .orderBy(asc(commits.committedAt));

  if (!rows.length) throw new NoDataError();

  let issueCount = 0;
  if (config.includeIssues) {
    const issueConditions = [eq(issues.type, "issue"), inArray(sql`lower(${issues.authorLogin})`, logins)];
    if (period) {
      issueConditions.push(gte(issues.createdAt, period.start), lt(issues.createdAt, period.end));
    }
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(issues)
      .where(and(...issueConditions));
    issueCount = row?.n ?? 0;
  }

  const commitData: ReportCommit[] = rows.map((r) => ({
    sha: r.sha,
    repository: r.repository,
    message: r.message,
    day: r.committedAt ? r.committedAt.toISOString().slice(0, 10) : "",
    category: r.category,
    url: r.url,
    additions: r.additions,
    deletions: r.deletions,
    filesChanged: r.filesChanged,
  }));

  const data: ReportData = {
    commits: commitData,
    issueCount,
    users: request.users,
    displayNames: config.userDisplayNames,
    periodStart: period?.startDay ?? commitData[0]?.day ?? "",
    periodEnd: period?.endDay ?? commitData[commitData.length - 1]?.day ?? "",
    audience,
    calc,
    showRemoved,
    includeIssues: config.includeIssues,
    notes: config.reportNotes,
  };

  return renderMarkdown(data);
}
