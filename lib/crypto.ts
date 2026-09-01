import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { requireEnv } from "@/lib/config/env";

/**
 * Symmetric encryption for secrets held in the database.
 *
 * The GitHub token is a live credential with repository access. Storing it in
 * plaintext would mean a database dump, a backup left somewhere, or a read-only
 * SQL leak hands over the organization's source. Encrypting it does not make
 * that impossible, but it changes what an attacker needs from one artefact to
 * two, and database dumps escape far more often than application secrets do.
 *
 * What this does NOT protect against, stated plainly so nobody assumes
 * otherwise: anyone who has both the database and AUTH_SECRET can read the
 * token, and so can anyone who can run code in the application. This is
 * protection at rest, not a secrets manager.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;

/**
 * Derive the encryption key from AUTH_SECRET rather than using it directly.
 *
 * The same secret also signs session tokens, and using one key for two purposes
 * is how unrelated primitives end up able to attack each other. HKDF with a
 * distinct info string keeps them independent.
 */
function key(): Buffer {
  const secret = requireEnv("AUTH_SECRET");
  return Buffer.from(hkdfSync("sha256", secret, "tgd-secret-salt", "tgd-secret-encryption-v1", KEY_BYTES));
}

/** Encrypt to "iv.authTag.ciphertext", each part base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext].map((b) => b.toString("base64url")).join(".");
}

/**
 * Decrypt a value produced by encryptSecret, or return null.
 *
 * Null rather than a throw because every realistic failure means the same
 * thing operationally: this value cannot be used. A rotated AUTH_SECRET, a
 * truncated column, a tampered row. The caller falls back to the environment
 * and the interface reports that no token is available, which is accurate.
 */
export function decryptSecret(stored: string): string | null {
  try {
    const [ivPart, tagPart, dataPart] = stored.split(".");
    if (!ivPart || !tagPart || !dataPart) return null;

    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64url"));
    // GCM verifies this on final(), so a tampered ciphertext throws rather than
    // decrypting to something plausible.
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Last four characters, for showing which token is set without revealing it. */
export function secretHint(plaintext: string): string {
  return plaintext.length <= 4 ? "" : plaintext.slice(-4);
}
