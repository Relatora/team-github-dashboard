import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * One row per commit, keyed by the full SHA.
 *
 * The six statistic columns are deliberately NULLABLE. NULL means "this commit
 * has not been enriched yet", which is distinct from 0 ("enriched, and it
 * changed nothing"). That distinction is what makes the never-clobber upsert in
 * lib/db/repositories/commits.ts work: a scan that did not fetch per-commit
 * detail writes NULL, and COALESCE keeps whatever enrichment already computed.
 *
 * Cleaned columns exclude generated and vendored paths and count merge commits
 * as zero. The raw columns are the unfiltered GitHub diff. Both are stored so
 * the dashboard can switch between them without re-fetching from the API.
 */
export const commits = pgTable(
  "commits",
  {
    sha: text("sha").primaryKey(),
    repository: text("repository").notNull(),
    message: text("message").notNull().default(""),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    authorLogin: text("author_login").notNull().default(""),
    authorName: text("author_name").notNull().default(""),
    authorEmail: text("author_email").notNull().default(""),
    category: text("category").notNull().default("Uncategorized"),
    url: text("url").notNull().default(""),
    apiUrl: text("api_url").notNull().default(""),
    isMerge: boolean("is_merge").notNull().default(false),

    additions: integer("additions"),
    deletions: integer("deletions"),
    filesChanged: integer("files_changed"),
    additionsRaw: integer("additions_raw"),
    deletionsRaw: integer("deletions_raw"),
    filesChangedRaw: integer("files_changed_raw"),
    statsVersion: integer("stats_version"),

    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Covers every dashboard query: filter by author, bounded by a date range.
    index("commits_author_committed_idx").on(t.authorLogin, t.committedAt),
    index("commits_repository_idx").on(t.repository),
    index("commits_category_idx").on(t.category),
    // Used by the enrichment sweep to find commits still needing stats.
    index("commits_stats_version_idx").on(t.statsVersion),
  ]
);

/**
 * Issues, and items the tracked user closed. The type column discriminates
 * them, mirroring the source tool which stored both in one collection.
 */
export const issues = pgTable(
  "issues",
  {
    id: text("id").primaryKey(), // repository#number
    type: text("type").notNull().default("issue"), // "issue" | "closed_item"
    number: integer("number"),
    title: text("title").notNull().default(""),
    state: text("state").notNull().default(""),
    repository: text("repository").notNull().default(""),
    authorLogin: text("author_login").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    labels: text("labels").notNull().default(""),
    url: text("url").notNull().default(""),
  },
  (t) => [
    index("issues_author_created_idx").on(t.authorLogin, t.createdAt),
    index("issues_repository_idx").on(t.repository),
    index("issues_type_idx").on(t.type),
  ]
);

/** Pull requests authored by tracked users. Written only when includePullRequests is on. */
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: text("id").primaryKey(),
    number: integer("number"),
    title: text("title").notNull().default(""),
    state: text("state").notNull().default(""),
    repository: text("repository").notNull().default(""),
    authorLogin: text("author_login").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    labels: text("labels").notNull().default(""),
    url: text("url").notNull().default(""),
  },
  (t) => [index("prs_author_created_idx").on(t.authorLogin, t.createdAt)]
);

/** Pull requests tracked users reviewed. Written only when includeReviews is on. */
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    number: integer("number"),
    title: text("title").notNull().default(""),
    state: text("state").notNull().default(""),
    repository: text("repository").notNull().default(""),
    authorLogin: text("author_login").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }),
    url: text("url").notNull().default(""),
  },
  (t) => [index("reviews_author_created_idx").on(t.authorLogin, t.createdAt)]
);

/**
 * One row per scan. displayNames maps a GitHub handle to a real name and is
 * what labels the roster, since a handle alone means little to a reader.
 * The incomplete flag marks a run the rate-limit guard cut short.
 */
export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    users: jsonb("users").$type<string[]>().notNull().default([]),
    displayNames: jsonb("display_names").$type<Record<string, string>>().notNull().default({}),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    incomplete: boolean("incomplete").notNull().default(false),
    message: text("message"),
  },
  (t) => [index("runs_generated_at_idx").on(t.generatedAt)]
);

/**
 * Dashboard settings, one row per user per app. The reserved user_email
 * "__global__" holds the organization-wide default; a real account's row
 * overrides it. See lib/settings for the resolution order.
 */
export const appSettings = pgTable(
  "app_settings",
  {
    userEmail: text("user_email").notNull(),
    app: text("app").notNull().default("github-dashboard"),
    layout: jsonb("layout").$type<unknown[]>().notNull().default([]),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    devSettings: jsonb("dev_settings").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userEmail, t.app] })]
);

/** Application accounts. Created by scripts/create-user.ts; there is no public signup. */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    passwordHash: text("password_hash").notNull(),
    roles: text("roles").array().notNull().default(["viewer"]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)]
);

/**
 * Resume state for a scan too large for one rate-limit window, keyed by scope,
 * period, and users. The source tool wrote this to scan_checkpoint.yaml;
 * keeping it in the database is what lets a scan resume on a host with no
 * durable filesystem.
 */
export const scanCheckpoints = pgTable("scan_checkpoints", {
  key: text("key").primaryKey(),
  completedRepos: text("completed_repos").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Discovered repository and branch lists, keyed by scan scope. Listing every
 * repository and every branch is the slow part of a scan and rarely changes
 * between runs; commits are always fetched live. Replaces repo_branch_cache.yaml.
 */
export const repoBranchCache = pgTable("repo_branch_cache", {
  scopeKey: text("scope_key").primaryKey(),
  mapping: jsonb("mapping").$type<Record<string, string[]>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommitRow = typeof commits.$inferSelect;
export type NewCommitRow = typeof commits.$inferInsert;
export type IssueRow = typeof issues.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type AppSettingsRow = typeof appSettings.$inferSelect;
