import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

/**
 * Database handle for long running work: the scanner, the enrichment sweep, and
 * the CLI scripts.
 *
 * Unlike the HTTP driver in ./client, this speaks the Postgres wire protocol
 * over a WebSocket and therefore supports transactions, which the batched
 * commit upserts need. It also keeps a real connection open, so callers must
 * close the pool when they are done or a CLI script will hang on exit.
 *
 * In Node there is no global WebSocket implementation before the runtime
 * provides one, so point neonConfig at ws.
 */
if (!globalThis.WebSocket) {
  neonConfig.webSocketConstructor = ws;
}

export function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and paste your Neon connection string."
    );
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export type PooledDatabase = ReturnType<typeof createPool>["db"];
