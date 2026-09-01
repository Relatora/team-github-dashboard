import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { secrets } from "@/lib/db/schema";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto";
import { GitHubClient, preflight } from "./client";

/**
 * Where the GitHub token comes from, and how it gets set.
 *
 * PRECEDENCE: stored token first, environment second.
 *
 * That is deliberately the reverse of the source tool, and the reason is trap 1
 * in docs/PORTING.md: there, a stale GITHUB_TOKEN in the OS environment
 * silently beat the one in the config file, so changing the token appeared to
 * do nothing and cost real debugging time. If the environment won here, saving
 * a token in the dashboard would appear to do nothing, which is the same trap
 * with a nicer interface. The active source is always named in the UI.
 */

const TOKEN_KEY = "github_token";

export type TokenSource = "stored" | "environment" | "none";

export type TokenStatus = {
  configured: boolean;
  source: TokenSource;
  /** Last four characters only. The token itself never leaves the server. */
  hint: string;
  /** The account the token resolved to when it was last validated. */
  label: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Whether the gh CLI is available on this host, so the UI can offer it. */
  ghCliAvailable: boolean;
};

/** The token to use for API calls, or undefined. */
export async function resolveToken(): Promise<string | undefined> {
  try {
    const rows = await getDb().select().from(secrets).where(eq(secrets.key, TOKEN_KEY)).limit(1);
    const stored = rows[0]?.value ? decryptSecret(rows[0].value) : null;
    if (stored) return stored;
  } catch {
    // An unreachable database must not make scanning impossible when the
    // environment already carries a perfectly good token.
  }

  return process.env.GITHUB_TOKEN || undefined;
}

export async function tokenStatus(): Promise<TokenStatus> {
  const ghCliAvailable = await isGhCliAvailable();

  let row: typeof secrets.$inferSelect | undefined;
  try {
    [row] = await getDb().select().from(secrets).where(eq(secrets.key, TOKEN_KEY)).limit(1);
  } catch {
    row = undefined;
  }

  if (row && decryptSecret(row.value)) {
    return {
      configured: true,
      source: "stored",
      hint: row.hint,
      label: row.label,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
      ghCliAvailable,
    };
  }

  const fromEnv = process.env.GITHUB_TOKEN;
  if (fromEnv) {
    return {
      configured: true,
      source: "environment",
      hint: secretHint(fromEnv),
      label: "",
      updatedAt: null,
      updatedBy: null,
      ghCliAvailable,
    };
  }

  return {
    configured: false,
    source: "none",
    hint: "",
    label: "",
    updatedAt: null,
    updatedBy: null,
    ghCliAvailable,
  };
}

export type TokenValidation = {
  ok: boolean;
  login?: string;
  coreRemaining?: number;
  coreLimit?: number;
  error?: string;
};

/**
 * Check a token against GitHub before storing it.
 *
 * Validating at the point of entry is the whole point: a bad token saved
 * silently fails later, during a scan, as an error that looks nothing like
 * "the token is wrong".
 */
export async function validateToken(token: string): Promise<TokenValidation> {
  const client = new GitHubClient({ token, minRemaining: 0, log: () => {} });

  try {
    const result = await preflight(client);
    if (!result.authenticated) {
      return { ok: false, error: "GitHub did not accept that token." };
    }
    return {
      ok: true,
      login: result.login,
      coreRemaining: result.coreRemaining,
      coreLimit: result.coreLimit,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A 401 is the common case and deserves plain language rather than the
    // raw API error.
    if (message.includes("401")) {
      return { ok: false, error: "GitHub rejected that token. It may be expired or revoked." };
    }
    return { ok: false, error: `Could not reach GitHub: ${message}` };
  }
}

export async function storeToken(token: string, updatedBy: string, label: string): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(secrets)
    .values({
      key: TOKEN_KEY,
      value: encryptSecret(token),
      hint: secretHint(token),
      label,
      updatedAt: now,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: secrets.key,
      set: { value: encryptSecret(token), hint: secretHint(token), label, updatedAt: now, updatedBy },
    });
}

/** Remove the stored token. The environment variable, if any, takes over again. */
export async function clearToken(): Promise<void> {
  await getDb().delete(secrets).where(eq(secrets.key, TOKEN_KEY));
}

/* ------------------------------------------------------------------ gh CLI */

const run = promisify(execFile);

/**
 * Is the gh CLI installed AND signed in on the machine running the server?
 *
 * Worth stating what this means in practice: on a deployed host it is almost
 * always false, because gh is a developer tool and nobody authenticates it on a
 * server. So this path is a local development convenience, and the interface
 * only offers it when it will actually work.
 */
export async function isGhCliAvailable(): Promise<boolean> {
  try {
    // gh writes its status to stderr and signals the answer through the exit
    // code, so a non-throwing call is the whole test: installed and signed in.
    await run("gh", ["auth", "status", "--active"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the token the gh CLI is holding.
 *
 * No user input reaches this command, so there is no injection surface: the
 * arguments are a fixed array and execFile does not use a shell.
 */
export async function readGhCliToken(): Promise<string | null> {
  try {
    const { stdout } = await run("gh", ["auth", "token"], { timeout: 5000 });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}
