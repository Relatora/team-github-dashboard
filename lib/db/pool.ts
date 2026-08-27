import "server-only";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import ws from "ws";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { connectionString, driverFor } from "./driver";

/**
 * Database handle for long running work: the scanner, the enrichment sweep, and
 * the CLI scripts.
 *
 * Unlike the HTTP handle in ./client, this supports transactions, which the
 * batched commit upserts need. It also holds real connections, so callers must
 * close it or a CLI script hangs on exit instead of finishing.
 *
 * Neon's WebSocket pool and node-postgres both speak enough of the same API
 * that Drizzle papers over the difference; the driver is still chosen from the
 * host, because Neon's pool cannot connect to an ordinary Postgres server.
 */

// Node has no global WebSocket in every version this may run on, and Neon's
// pool needs one.
if (!globalThis.WebSocket) {
  neonConfig.webSocketConstructor = ws;
}

/** As in ./client: one representative type, so call sites do not face a union. */
export type PooledDatabase = NodePgDatabase<typeof schema>;

export function createPool(): { db: PooledDatabase; close: () => Promise<void> } {
  const url = connectionString();

  if (driverFor(url) === "neon") {
    const pool = new NeonPool({ connectionString: url });
    return { db: drizzleNeon(pool, { schema }) as unknown as PooledDatabase, close: () => pool.end() };
  }

  const pool = new PgPool({ connectionString: url });
  return { db: drizzlePg(pool, { schema }), close: () => pool.end() };
}
