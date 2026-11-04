import type Database from "better-sqlite3";
import type { RunRow } from "@/lib/db/schema";
import type { RunSummaryInput } from "../types";

export function recordRun(db: Database.Database, summary: RunSummaryInput): void {
  db.prepare(
    `insert into runs (period_start, period_end, users, display_names, scope, counts, incomplete, message)
     values (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    summary.periodStart ? summary.periodStart.toISOString() : null,
    summary.periodEnd ? summary.periodEnd.toISOString() : null,
    JSON.stringify(summary.users),
    JSON.stringify(summary.displayNames),
    JSON.stringify(summary.scope),
    JSON.stringify(summary.counts),
    summary.incomplete ? 1 : 0,
    summary.message ?? null
  );
}

export function listRuns(db: Database.Database, limit = 10): RunRow[] {
  const capped = Math.min(Math.max(limit, 1), 50);
  const rows = db.prepare(`select * from runs order by generated_at desc limit ?`).all(capped) as Array<{
    id: number;
    generated_at: string;
    period_start: string | null;
    period_end: string | null;
    users: string;
    display_names: string;
    scope: string;
    counts: string;
    incomplete: number;
    message: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    generatedAt: new Date(r.generated_at),
    periodStart: r.period_start ? new Date(r.period_start) : null,
    periodEnd: r.period_end ? new Date(r.period_end) : null,
    users: JSON.parse(r.users),
    displayNames: JSON.parse(r.display_names),
    scope: JSON.parse(r.scope),
    counts: JSON.parse(r.counts),
    incomplete: Boolean(r.incomplete),
    message: r.message,
  }));
}
