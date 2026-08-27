import { config } from "dotenv";

/**
 * Load environment files for code that runs outside Next.
 *
 * Next loads .env.local automatically; drizzle-kit and the CLI scripts do not,
 * and importing "dotenv/config" only reads .env. Without this, everything
 * documented as living in .env.local works in the application and fails from
 * the command line, which is a confusing way to lose an hour.
 *
 * Order matters: dotenv does not overwrite a variable that is already set, so
 * the first file listed wins, and anything already in the real environment wins
 * over both.
 */
config({ path: [".env.local", ".env"], quiet: true });
