import { GitHubApiError, RateLimitBudgetError } from "./errors";

/**
 * The single gateway for every GitHub API call.
 *
 * Nothing else in the codebase may talk to the API directly. That is not a
 * style preference: the rate-limit accounting only works if every request
 * passes through one place that reads the response headers. One bypassing call
 * and the budget guard is working from stale numbers.
 *
 * Ported from GitHubClient in github_work_report.py.
 */

export type RateLimitAction = "stop" | "wait";

export type ClientOptions = {
  token?: string;
  apiBase?: string;
  /** Politeness delay between requests, in milliseconds. */
  sleepMs?: number;
  /** Stop or wait once the core quota reaches this floor. 0 disables the guard. */
  minRemaining?: number;
  rateLimitAction?: RateLimitAction;
  /** Progress messages. Defaults to console. */
  log?: (message: string) => void;
};

type Bucket = { remaining?: number; reset?: number; limit?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GitHubClient {
  private readonly apiBase: string;
  private readonly token?: string;
  private readonly sleepMs: number;
  private readonly minRemaining: number;
  private readonly action: RateLimitAction;
  private readonly log: (message: string) => void;

  /**
   * Live quota per GitHub resource, refreshed from response headers.
   *
   * core and search must never be conflated: core allows 5,000 requests an hour
   * while search allows about 30 a minute. Treating them as one budget either
   * stops a scan that had plenty of core quota left, or fails to stop one that
   * did not.
   */
  private readonly buckets = new Map<string, Bucket>();

  /** Set once the guard fires, so a caller can report "incomplete" rather than "0 results". */
  budgetHit = false;
  requestCount = 0;

  constructor(options: ClientOptions = {}) {
    this.apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
    this.token = options.token;
    this.sleepMs = options.sleepMs ?? 150;
    this.minRemaining = Math.max(0, options.minRemaining ?? 0);
    this.action = options.rateLimitAction ?? "stop";
    this.log = options.log ?? ((m) => console.error(m));
  }

  get authenticated(): boolean {
    return Boolean(this.token);
  }

  /** Which quota a URL draws from. Only search has a small ceiling. */
  private static resourceFor(url: string): string {
    return url.includes("/search/") ? "search" : "core";
  }

  private noteHeaders(response: Response, url: string): void {
    const resource = response.headers.get("x-ratelimit-resource") ?? GitHubClient.resourceFor(url);
    const bucket = this.buckets.get(resource) ?? {};
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const limit = response.headers.get("x-ratelimit-limit");
    if (remaining !== null) bucket.remaining = Number(remaining);
    if (reset !== null) bucket.reset = Number(reset);
    if (limit !== null) bucket.limit = Number(limit);
    this.buckets.set(resource, bucket);
  }

  /**
   * Before a request, stop or wait if the budget is spent.
   *
   * Enforced only for core. search has its own small per-minute window, which
   * the hard 403 handler below rides out by sleeping; applying a floor to it
   * would stop a scan over a quota that refills in under a minute.
   */
  private async enforceBudget(resource: string): Promise<void> {
    if (this.minRemaining <= 0 || resource !== "core") return;

    const bucket = this.buckets.get(resource);
    if (!bucket || bucket.remaining === undefined) return;
    if (bucket.remaining > this.minRemaining) return;

    if (this.action === "wait") {
      if (bucket.reset) {
        const waitSeconds = Math.max(1, bucket.reset - Math.floor(Date.now() / 1000) + 2);
        this.log(
          `GitHub core quota low (${bucket.remaining} left); sleeping ${waitSeconds}s until reset.`
        );
        await sleep(waitSeconds * 1000);
        // Force a refresh from the next response rather than trusting the
        // pre-sleep number, which is now stale.
        delete bucket.remaining;
      }
      return;
    }

    this.budgetHit = true;
    throw new RateLimitBudgetError(bucket.remaining, bucket.reset);
  }

  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.apiBase}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const resource = GitHubClient.resourceFor(url.toString());
    let serverErrors = 0;

    for (;;) {
      await this.enforceBudget(resource);

      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "team-github-dashboard",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
      this.requestCount += 1;
      this.noteHeaders(response, url.toString());

      // Hard rate limit. Short windows (search) are worth sleeping through; a
      // long core window honours the configured action, because sleeping out a
      // full hour is never what the caller wanted.
      if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get("x-ratelimit-remaining");
        const reset = Number(response.headers.get("x-ratelimit-reset"));
        if (remaining === "0" && reset) {
          const waitSeconds = Math.max(1, reset - Math.floor(Date.now() / 1000) + 2);
          if (this.action === "stop" && waitSeconds > 120) {
            this.budgetHit = true;
            throw new RateLimitBudgetError(0, reset);
          }
          this.log(`GitHub rate limit reached. Sleeping ${waitSeconds}s.`);
          await sleep(waitSeconds * 1000);
          continue;
        }
      }

      // Transient upstream hiccups. Retry a few times with backoff before
      // giving up, since a 502 mid-scan should not discard a run.
      if (response.status >= 500 && serverErrors < 3) {
        serverErrors += 1;
        const backoff = Math.min(8, 2 ** serverErrors);
        this.log(`GitHub ${response.status} for ${url.pathname}; retry ${serverErrors}/3 in ${backoff}s.`);
        await sleep(backoff * 1000);
        continue;
      }

      if (!response.ok) {
        throw new GitHubApiError(response.status, url.toString(), (await response.text()).slice(0, 500));
      }

      if (this.sleepMs) await sleep(this.sleepMs);
      return (await response.json()) as T;
    }
  }

  /** Follow pagination until exhausted or `maxItems` is reached. */
  async paged<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    maxItems?: number
  ): Promise<T[]> {
    const perPage = Number(params.per_page ?? 100);
    const items: T[] = [];

    for (let page = 1; ; page++) {
      const data = await this.get<T[] | { items: T[] }>(path, { ...params, per_page: perPage, page });
      const batch = Array.isArray(data) ? data : (data?.items ?? []);
      if (!batch.length) break;

      items.push(...batch);
      if (maxItems && items.length >= maxItems) return items.slice(0, maxItems);
      // A short page means there is no next one.
      if (batch.length < perPage) break;
    }

    return items;
  }

  /** Current view of a quota, from the last response that touched it. */
  quota(resource = "core"): Bucket | undefined {
    return this.buckets.get(resource);
  }
}

export type Preflight = {
  authenticated: boolean;
  login?: string;
  scopes?: string[];
  coreRemaining: number;
  coreLimit: number;
  warnings: string[];
};

/**
 * Check the token before a scan and report what it can actually do.
 *
 * Worth doing up front because the two most common failures look nothing like
 * rate limiting when they surface later: an unauthenticated client gets 60
 * requests an hour and dies almost immediately, and a token without read:org
 * makes organization member listing return an empty 200 rather than an error.
 */
export async function preflight(client: GitHubClient): Promise<Preflight> {
  const warnings: string[] = [];

  const limits = await client.get<{
    resources: { core: { remaining: number; limit: number } };
  }>("/rate_limit");
  const core = limits.resources.core;

  if (!client.authenticated) {
    warnings.push(
      "No GitHub token. Unauthenticated requests are capped at 60 per hour, which will not " +
        "finish a scan. Set GITHUB_TOKEN."
    );
    return {
      authenticated: false,
      coreRemaining: core.remaining,
      coreLimit: core.limit,
      warnings,
    };
  }

  let login: string | undefined;
  try {
    login = (await client.get<{ login: string }>("/user")).login;
  } catch {
    // A fine-grained token may not be allowed to read /user. That is not fatal.
  }

  if (core.remaining <= 100) {
    warnings.push(
      `Only ${core.remaining} core requests left this hour. A scan will stop early and resume later.`
    );
  }

  return {
    authenticated: true,
    login,
    coreRemaining: core.remaining,
    coreLimit: core.limit,
    warnings,
  };
}
