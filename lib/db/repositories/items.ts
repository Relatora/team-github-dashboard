import { desc, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { issues, pullRequests, reviews, runs } from "@/lib/db/schema";
import type { PooledDatabase } from "@/lib/db/pool";
import type { RawIssue } from "@/lib/github/types";

/** Issues, pull requests, reviews, and run summaries. */

/** "https://github.com/owner/name/issues/12" -> "owner/name" */
export function repoFromIssueUrl(url: string): string {
  const match = /github\.com\/([^/]+\/[^/]+)\//.exec(url ?? "");
  return match ? match[1] : "";
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type ItemRow = {
  id: string;
  type: string;
  number: number | null;
  title: string;
  state: string;
  repository: string;
  authorLogin: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  closedAt: Date | null;
  labels: string;
  url: string;
};

export function normalizeIssue(item: RawIssue, type = "issue"): ItemRow {
  const url = item.html_url ?? "";
  const repository = repoFromIssueUrl(url);
  return {
    id: `${repository}#${item.number ?? ""}`,
    type,
    number: item.number ?? null,
    title: item.title ?? "",
    state: item.state ?? "",
    repository,
    // Captured so per-person issue counts are possible. Rows ingested before
    // the source tool started storing this have an empty login, and they are
    // skipped rather than shown for everyone.
    authorLogin: item.user?.login ?? "",
    createdAt: toDate(item.created_at),
    updatedAt: toDate(item.updated_at),
    closedAt: toDate(item.closed_at),
    labels: (item.labels ?? []).map((l) => l.name).filter(Boolean).join(", "),
    url,
  };
}

export async function upsertIssues(db: PooledDatabase, rows: ItemRow[]): Promise<number> {
  if (!rows.length) return 0;
  await db
    .insert(issues)
    .values(rows)
    .onConflictDoUpdate({
      target: issues.id,
      set: {
        type: sql`excluded.type`,
        title: sql`excluded.title`,
        state: sql`excluded.state`,
        // Never let a later ingest blank out an author that was captured once.
        authorLogin: sql`nullif(excluded.author_login, '')`,
        updatedAt: sql`excluded.updated_at`,
        closedAt: sql`excluded.closed_at`,
        labels: sql`excluded.labels`,
      },
    });
  return rows.length;
}

// Pull requests and reviews carry a subset of the issue columns, so the shared
// ItemRow is narrowed explicitly rather than by destructuring the unwanted keys
// into throwaway variables.
export async function upsertPullRequests(db: PooledDatabase, rows: ItemRow[]): Promise<number> {
  if (!rows.length) return 0;
  await db
    .insert(pullRequests)
    .values(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        state: r.state,
        repository: r.repository,
        authorLogin: r.authorLogin,
        createdAt: r.createdAt,
        closedAt: r.closedAt,
        labels: r.labels,
        url: r.url,
      }))
    )
    .onConflictDoUpdate({
      target: pullRequests.id,
      set: { state: sql`excluded.state`, closedAt: sql`excluded.closed_at` },
    });
  return rows.length;
}

export async function upsertReviews(db: PooledDatabase, rows: ItemRow[]): Promise<number> {
  if (!rows.length) return 0;
  await db
    .insert(reviews)
    .values(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        state: r.state,
        repository: r.repository,
        authorLogin: r.authorLogin,
        createdAt: r.createdAt,
        url: r.url,
      }))
    )
    .onConflictDoUpdate({
      target: reviews.id,
      set: { state: sql`excluded.state` },
    });
  return rows.length;
}

export type RunSummary = {
  periodStart: Date | null;
  periodEnd: Date | null;
  users: string[];
  displayNames: Record<string, string>;
  scope: Record<string, unknown>;
  counts: Record<string, number>;
  incomplete: boolean;
  message?: string;
};

export async function recordRun(db: PooledDatabase, summary: RunSummary): Promise<void> {
  await db.insert(runs).values(summary);
}

export async function listRuns(limit = 10) {
  return getDb()
    .select()
    .from(runs)
    .orderBy(desc(runs.generatedAt))
    .limit(Math.min(Math.max(limit, 1), 50));
}

/**
 * Curated handle to real name mapping from the most recent run.
 *
 * The roster is labelled from this, because a handle alone tells a leadership
 * reader nothing.
 */
export async function latestDisplayNames(): Promise<Record<string, string>> {
  const rows = await getDb()
    .select({ displayNames: runs.displayNames })
    .from(runs)
    .orderBy(desc(runs.generatedAt))
    .limit(1);
  return rows[0]?.displayNames ?? {};
}
