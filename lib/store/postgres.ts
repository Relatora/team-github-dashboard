import { sql } from "drizzle-orm";
import { createPool } from "@/lib/db/pool";
import {
  upsertCommits as pgUpsertCommits,
} from "@/lib/db/repositories/commits";
import {
  upsertIssues as pgUpsertIssues,
  recordRun as pgRecordRun,
  listRuns as pgListRuns,
} from "@/lib/db/repositories/items";
import { getMetrics as pgGetMetrics, getUsers as pgGetUsers } from "@/lib/metrics/aggregate";
import type { Store } from "./types";

/**
 * The Postgres adapter.
 *
 * Every method delegates to the existing repository functions and
 * lib/metrics/aggregate.ts, unchanged. This wraps the code that already runs
 * against real data - it does not reimplement it, so real data is never at
 * risk from this abstraction existing.
 */
export function postgresStore(): Store {
  return {
    async upsertCommits(rows) {
      const { db, close } = createPool();
      try {
        return await pgUpsertCommits(db, rows);
      } finally {
        await close();
      }
    },

    async getCommitForVerification(sha) {
      const { db, close } = createPool();
      try {
        const result = await db.execute<{
          message: string;
          additions: number | null;
          deletions: number | null;
          files_changed: number | null;
          additions_raw: number | null;
          stats_version: number | null;
        }>(sql`
          select message, additions, deletions, files_changed, additions_raw, stats_version
          from commits where sha = ${sha}
        `);
        const row = result.rows[0];
        if (!row) return null;
        return {
          message: row.message,
          additions: row.additions,
          deletions: row.deletions,
          filesChanged: row.files_changed,
          additionsRaw: row.additions_raw,
          statsVersion: row.stats_version,
        };
      } finally {
        await close();
      }
    },

    async deleteCommit(sha) {
      const { db, close } = createPool();
      try {
        await db.execute(sql`delete from commits where sha = ${sha}`);
      } finally {
        await close();
      }
    },

    async upsertIssues(rows) {
      const { db, close } = createPool();
      try {
        return await pgUpsertIssues(db, rows);
      } finally {
        await close();
      }
    },

    async recordRun(summary) {
      const { db, close } = createPool();
      try {
        await pgRecordRun(db, summary);
      } finally {
        await close();
      }
    },

    listRuns: (limit) => pgListRuns(limit),
    getMetrics: (query) => pgGetMetrics(query),
    getRoster: (displayNames) => pgGetUsers(displayNames),
  };
}
