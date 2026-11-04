import type { NewCommitRow, RunRow } from "@/lib/db/schema";
import type { ItemRow } from "@/lib/db/repositories/items";
import type { Metrics, MetricsQuery, RosterUser } from "@/lib/metrics/aggregate";

/**
 * The storage port: what the app needs from a database, independent of which
 * one is behind it.
 *
 * The Postgres adapter (./postgres.ts) wraps the existing repository
 * functions and lib/metrics/aggregate.ts unchanged. The SQLite adapter
 * (./sqlite) is a real second implementation, used only by the public demo
 * route and by scripts/verify-invariants.ts to prove this interface is
 * genuinely portable rather than two functions that happen to share a name.
 *
 * This is deliberately not threaded through the rest of the app: route
 * handlers, the scanner, and the CLI scripts keep calling
 * lib/db/repositories/* directly, exactly as before this existed.
 */

export interface CommitStore {
  /**
   * Insert or update commits by sha.
   *
   * THE NEVER-CLOBBER RULE, which every adapter must preserve: a statistic
   * column (additions, deletions, filesChanged, their raw counterparts, and
   * statsVersion) that already holds a non-null value must never be
   * regressed to null by a row that omits it - a plain scan has no
   * statistics to write, and must not erase what enrichment already
   * computed. Descriptive columns (message, repository, category, ...)
   * always take the newer value. scripts/verify-invariants.ts is the
   * executable spec for this rule.
   */
  upsertCommits(rows: NewCommitRow[]): Promise<number>;

  /** Verification only: read back a commit's current stored values. */
  getCommitForVerification(sha: string): Promise<{
    message: string;
    additions: number | null;
    deletions: number | null;
    filesChanged: number | null;
    additionsRaw: number | null;
    statsVersion: number | null;
  } | null>;

  /** Verification only: remove a commit written for a test. */
  deleteCommit(sha: string): Promise<void>;
}

export interface IssueStore {
  upsertIssues(rows: ItemRow[]): Promise<number>;
}

export interface MetricsStore {
  getMetrics(query: MetricsQuery): Promise<Metrics>;
  /** The roster: everyone selectable in the dashboard's user controls. */
  getRoster(displayNames?: Record<string, string>): Promise<RosterUser[]>;
}

export type RunSummaryInput = {
  periodStart: Date | null;
  periodEnd: Date | null;
  users: string[];
  displayNames: Record<string, string>;
  scope: Record<string, unknown>;
  counts: Record<string, number>;
  incomplete: boolean;
  message?: string;
};

export interface RunStore {
  recordRun(summary: RunSummaryInput): Promise<void>;
  listRuns(limit?: number): Promise<RunRow[]>;
}

export interface Store extends CommitStore, IssueStore, MetricsStore, RunStore {}
