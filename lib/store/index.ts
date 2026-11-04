import { postgresStore } from "./postgres";
import { sqliteStore } from "./sqlite";
import type { Store } from "./types";

/**
 * Guard against this module reaching the browser.
 *
 * `server-only` throws under plain Node too, and scripts/verify-invariants.ts
 * and scripts/seed-demo.ts legitimately import this outside Next. See the
 * identical guard in lib/db/client.ts for why this shape and not the package.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "lib/store is server only. A client component is importing it, which would ship " +
      "database credentials and driver code to the browser. Call an API route instead."
  );
}

export type { Store, RunSummaryInput, CommitStore, IssueStore, MetricsStore, RunStore } from "./types";

let pg: Store | null = null;
/** The real data store: Postgres, wrapping the existing repository functions. */
export function getStore(): Store {
  pg ??= postgresStore();
  return pg;
}

let demo: Store | null = null;
/** The demo data store: SQLite, read by the public /demo route only. */
export function getDemoStore(): Store {
  demo ??= sqliteStore();
  return demo;
}
