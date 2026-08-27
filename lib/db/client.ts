import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Database handle for request handling.
 *
 * This uses Neon's HTTP driver, which sends one statement per round trip and
 * holds no connection. That is the right shape for route handlers, which are
 * short lived and may run in many instances at once.
 *
 * It cannot do transactions. Anything that needs one - the batched upserts in
 * the scanner - must use the WebSocket pool from ./pool instead.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and paste your Neon connection string."
    );
  }
  return url;
}

// Created lazily so importing this module never throws at build time, when the
// environment is not necessarily populated.
let cached: ReturnType<typeof create> | null = null;

function create() {
  return drizzle(neon(connectionString()), { schema });
}

export function getDb() {
  if (!cached) cached = create();
  return cached;
}

export type Database = ReturnType<typeof getDb>;
export { schema };
