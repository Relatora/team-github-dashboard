/**
 * Which Postgres driver a connection string needs.
 *
 * Neon's serverless driver speaks Neon's own HTTP and WebSocket protocols, not
 * the Postgres wire protocol, so it cannot talk to an ordinary Postgres server
 * at all. Pointing it at localhost does not fail loudly; it hangs.
 *
 * Self-hosting is a supported deployment (docker-compose.yml ships a Postgres
 * container), so the driver is chosen from the host rather than assumed.
 */
export type DriverKind = "neon" | "postgres";

export function driverFor(connectionString: string): DriverKind {
  try {
    const host = new URL(connectionString).hostname;
    // Neon endpoints are *.neon.tech, and Vercel's and other resellers' Neon
    // instances follow the same ep-<name> convention.
    return host.endsWith(".neon.tech") || host.startsWith("ep-") ? "neon" : "postgres";
  } catch {
    // An unparseable string is somebody's hand written local DSN far more often
    // than it is a Neon URL.
    return "postgres";
  }
}

export function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add a connection string. " +
        "See docs/NEON_SETUP.md, or use docker-compose for a local Postgres."
    );
  }
  return url;
}
