import { z } from "zod";

/**
 * Files whose churn is generated or vendored rather than hand written. Their
 * additions and deletions wildly inflate line counts: a committed venv or
 * node_modules directory, a regenerated lock file, a minified bundle. They are
 * excluded from the cleaned statistics.
 *
 * Entries ending in "/" match any path segment. The rest are globs matched
 * against both the full path and the basename.
 */
export const DEFAULT_STAT_IGNORE_GLOBS = [
  "node_modules/",
  "venv/",
  ".venv/",
  "env/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  "coverage/",
  "vendor/",
  "__pycache__/",
  "bin/",
  "obj/",
  ".git/",
  "*.lock",
  "package-lock.json",
  "*-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.bundle.js",
];

/**
 * Branch names treated as long lived, used when branchScanScope is "active".
 * Case insensitive globs.
 */
export const DEFAULT_LONG_LIVED_BRANCHES = [
  "main",
  "master",
  "develop",
  "development",
  "release/*",
  "releases/*",
  "hotfix/*",
];

const isoDateOrToday = z
  .string()
  .refine((v) => v === "today" || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: 'Expected "today" or a YYYY-MM-DD date',
  });

export const scanConfigSchema = z.object({
  /** GitHub handles whose work is collected. */
  githubUsernames: z.array(z.string().min(1)).default([]),

  /**
   * Handle to real name. A handle like "Hempie31" tells a leadership reader
   * nothing, so the dashboard and report label people by these names.
   */
  userDisplayNames: z.record(z.string(), z.string()).default({}),

  /**
   * Extra identities used to attribute commits made with an email that is not
   * linked to the GitHub account. Without these, real work is invisible.
   */
  authorEmails: z.array(z.string()).default([]),
  authorNames: z.array(z.string()).default([]),

  organizations: z.array(z.string()).default([]),
  /** Explicit repositories, as "owner/name". Takes priority over organizations. */
  repositories: z.array(z.string()).default([]),

  startDate: isoDateOrToday.default("2022-01-01"),
  /**
   * Keep this as "today" unless you have a reason not to. A fixed end date
   * silently drifts into the past and a scan never looks beyond it, so work
   * pushed after that date stops appearing and the dashboard looks empty for
   * no visible reason. This bit the source tool.
   */
  endDate: isoDateOrToday.default("today"),

  /**
   * Which branches to discover. "all" lists every branch; an explicit list
   * restricts discovery to those names.
   */
  branches: z.union([z.literal("all"), z.array(z.string())]).default("all"),

  /**
   * How many discovered branches to actually scan.
   *
   * "all" is complete coverage, including work living only on an unmerged
   * feature branch. "active" scans long lived branches only: fewer API calls,
   * but it under-counts anyone whose work sits on an open PR branch. Use it as
   * a rate-limit saver on very large organizations, not when the numbers matter.
   */
  branchScanScope: z.enum(["all", "active"]).default("all"),
  longLivedBranches: z.array(z.string()).default(DEFAULT_LONG_LIVED_BRANCHES),

  /**
   * Ask GitHub for only each author's commits per branch instead of
   * downloading every commit and filtering locally. Far fewer API calls on busy
   * branches. Set false only if you rely on authorNames matching, which the
   * server side filter cannot do.
   */
  serverSideAuthorFilter: z.boolean().default(true),

  /**
   * Rate-limit floor. The scan stops cleanly with partial results once the
   * remaining core quota reaches this number, rather than blocking roughly
   * fifteen minutes for a reset, which reads to a user as a hang.
   */
  rateLimitMinRemaining: z.number().int().min(0).default(150),
  rateLimitAction: z.enum(["stop", "wait"]).default("stop"),

  /** Fetch per-commit detail for line and file statistics. One API call per commit. */
  fetchCommitDetails: z.boolean().default(true),
  /**
   * Merge commits re-show the diff of everything they merged, double counting
   * it. They contribute zero to the cleaned totals while staying in the raw
   * ones, and are still counted as commits under "Merges & branch sync".
   */
  excludeMergeCommitsFromStats: z.boolean().default(true),
  statIgnoreGlobs: z.array(z.string()).default(DEFAULT_STAT_IGNORE_GLOBS),

  /** Optional non-commit sections. Off by default; each one costs extra API calls. */
  includeIssues: z.boolean().default(true),
  includePullRequests: z.boolean().default(false),
  includeReviews: z.boolean().default(false),
  includeClosed: z.boolean().default(false),

  /** Manual notes appended to the report, for impact GitHub activity cannot explain. */
  reportNotes: z.array(z.string()).default([]),

  githubApiBase: z.string().url().default("https://api.github.com"),
  maxItemsPerSearch: z.number().int().positive().default(1000),
  /** Concurrent branch requests during a scan. Higher burns quota faster. */
  scanConcurrency: z.number().int().min(1).max(16).default(4),
});

export type ScanConfig = z.infer<typeof scanConfigSchema>;
