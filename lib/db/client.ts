import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { connectionString, driverFor } from "./driver";

/**
 * Guard against this module reaching the browser.
 *
 * `server-only` is the usual tool, but it throws under plain Node too, and the
 * CLI scripts legitimately import this outside Next. This check catches the
 * case that actually matters - a client component pulling the data layer into
 * the browser bundle - while leaving `tsx scripts/...` working.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "lib/db is server only. A client component is importing it, which would ship " +
      "database credentials and driver code to the browser. Import types from " +
      "lib/settings/types or call an API route instead."
  );
}

/**
 * Database handle for request handling.
 *
 * Against Neon this uses the HTTP driver: one statement per round trip, no held
 * connection, which is the right shape for route handlers that are short lived
 * and may run in many instances at once. It cannot do transactions; anything
 * that needs one uses the pool in ./pool instead.
 *
 * Against an ordinary Postgres server it uses node-postgres, because Neon's
 * driver speaks Neon's protocol rather than the Postgres wire protocol and
 * simply hangs when pointed anywhere else.
 */

/**
 * Both drivers are typed as node-postgres.
 *
 * They produce different concrete Drizzle classes, and a union of the two
 * collapses the query builder overloads at every call site. Both extend
 * PgDatabase and both return `{ rows }` from execute, so one representative
 * type keeps every caller correctly typed. The cast is confined to this file.
 */
export type Database = NodePgDatabase<typeof schema>;

// Created lazily so importing this module never throws at build time, when the
// environment is not necessarily populated.
let cached: Database | null = null;

function create(): Database {
  const url = connectionString();

  if (driverFor(url) === "neon") {
    return drizzleNeon(neon(url), { schema }) as unknown as Database;
  }

  // One pool per process, reused across requests. A pool per request would
  // exhaust the server's connection limit under any real load.
  return drizzlePg(new Pool({ connectionString: url }), { schema });
}

export function getDb(): Database {
  cached ??= create();
  return cached;
}

export { schema };
