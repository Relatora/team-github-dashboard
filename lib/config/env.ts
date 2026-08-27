import { z } from "zod";

/**
 * Secrets and deployment settings. Kept separate from the scan scope in
 * ./index because these must never be committed.
 *
 * Every read goes through here so a missing or malformed variable produces one
 * clear message at the point of use, instead of a confusing failure much later.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),

  /**
   * Signing key for session tokens. Must be at least 32 bytes: a short secret
   * makes HS256 brute forcible, and a weak session key is a full account
   * takeover, not a minor issue. Generate one with:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   */
  AUTH_SECRET: z.string().min(32).optional(),

  /**
   * The kill switch. Set to "false" and every guard returns a local user
   * holding every role, and the middleware stops redirecting to the login page.
   * Intended for a trusted internal deployment that wants no sign-in at all.
   */
  AUTH_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  /** Personal access token used for scans. Needs repo and read:org. */
  GITHUB_TOKEN: z.string().optional(),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment is not valid:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Throw a readable error naming the variable, rather than failing deeper in. */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === "") {
    throw new Error(`${key} is not set. See .env.example for what it should contain.`);
  }
  return value as NonNullable<Env[K]>;
}

export function isAuthEnabled(): boolean {
  return env().AUTH_ENABLED;
}

/**
 * Resolve the GitHub token.
 *
 * A trap worth knowing about, carried over from the source tool: a stale
 * GITHUB_TOKEN left in the OS environment silently wins over one set in a file,
 * so changing the token appears to do nothing. On Windows, clear it with:
 *   [Environment]::SetEnvironmentVariable("GITHUB_TOKEN", $null, "User")
 * Environment changes also only reach newly opened terminals.
 */
export function resolveGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || undefined;
}
