/** A non-OK GitHub response. Carries the status so callers can treat 404 as "skip this repo". */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string
  ) {
    super(`GitHub API error ${status} for ${url}: ${message}`);
    this.name = "GitHubApiError";
  }
}

/**
 * Thrown when the remaining core quota reaches the configured floor.
 *
 * This is not a failure. It is how a long scan stops cleanly with partial
 * results instead of blocking for roughly fifteen minutes waiting on a reset,
 * which to anyone watching looks like a hang. Callers catch it, keep what they
 * collected, and flag the run incomplete.
 */
export class RateLimitBudgetError extends Error {
  constructor(
    readonly remaining: number,
    readonly resetEpoch?: number
  ) {
    const waitSeconds = resetEpoch ? Math.max(0, resetEpoch - Math.floor(Date.now() / 1000)) : null;
    const when = waitSeconds ? ` Quota resets in about ${Math.ceil(waitSeconds / 60)} min.` : "";
    super(`GitHub rate-limit budget reached (remaining ${remaining}).${when}`);
    this.name = "RateLimitBudgetError";
  }
}

export function isRateLimitBudgetError(error: unknown): error is RateLimitBudgetError {
  return error instanceof RateLimitBudgetError;
}
