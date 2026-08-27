/**
 * Fixed window rate limiter for the login route.
 *
 * In process and per instance, which is the honest scope: behind several
 * instances an attacker gets the limit multiplied by the instance count. That
 * is still a large reduction over no limit, and the alternative - a shared
 * store - is not worth adding to a single-team tool. If this ever runs at
 * scale, replace the map with Redis and nothing else changes.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Sweep expired windows so a burst of unique addresses cannot grow the map without bound. */
function sweep(now: number) {
  if (windows.size < 1000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Clear a key after a successful sign-in, so one person's typo does not lock them out. */
export function resetRateLimit(key: string): void {
  windows.delete(key);
}

/**
 * Best effort client address.
 *
 * X-Forwarded-For is trivially spoofed unless a trusted proxy sets it, so this
 * is a speed bump against casual brute force, not an access control. The real
 * protection is argon2's cost per attempt.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
