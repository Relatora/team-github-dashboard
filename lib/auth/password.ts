import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id. The library exports this as an ambient const enum, which TypeScript
 * cannot inline under isolatedModules, so the value is written out. It is also
 * the library default; stating it explicitly means a future default change
 * cannot silently downgrade us to argon2i.
 */
const ARGON2ID = 2;

/**
 * Argon2id parameters.
 *
 * These follow the OWASP Password Storage guidance for argon2id: 19 MiB of
 * memory, two iterations, one degree of parallelism. Memory cost is the setting
 * that matters most, because it is what makes GPU cracking expensive; raising
 * only the iteration count buys far less.
 *
 * Changing these does not invalidate existing hashes. Argon2 encodes its own
 * parameters in the hash string, so old passwords keep verifying and only new
 * ones use the new cost.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A real argon2id hash of a value nobody knows, used to burn the same CPU time
 * when the account does not exist.
 *
 * Without this, a login attempt for an unknown email returns in microseconds
 * while a wrong password for a real account takes ~50ms, and that difference
 * enumerates valid accounts for anyone who measures it.
 */
let dummyHash: string | null = null;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    // A malformed or truncated hash in the database must read as "wrong
    // password", never as an error that leaks that the row exists.
    return false;
  }
}

/**
 * Spend the same time as a real verification when there is no user to check
 * against. Call this on the "account not found" path.
 */
export async function burnVerifyTime(plain: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword("password-that-is-never-used");
  await verifyPassword(dummyHash, plain);
}

/**
 * Minimum viable password policy: length, and nothing else.
 *
 * Composition rules (a digit, a symbol, mixed case) are actively
 * counterproductive - they push people toward predictable substitutions - and
 * NIST dropped them. Length is what matters.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function validatePassword(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (plain.length > 1024) {
    // Argon2 is memory hard by design; an unbounded input is a cheap way to
    // make the server do expensive work.
    return "Password must be at most 1024 characters.";
  }
  return null;
}
