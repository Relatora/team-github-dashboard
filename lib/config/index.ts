import { scanConfigSchema, type ScanConfig } from "./schema";
import bundledConfig from "@/config/scan.json";

export * from "./schema";

/**
 * The scan scope: which people, which organizations, which branches, and how
 * aggressively to spend API quota. Replaces gitHubConfig.yaml from the Python
 * tool.
 *
 * Two layers, split along what is safe to commit.
 *
 * `config/scan.json` holds the settings that are policy rather than identity:
 * branch scope, the rate-limit floor, the ignore globs, which sections to
 * include. It is committed, because a reviewer should be able to see in git
 * when that policy changed, and it is imported rather than read from disk so
 * the bundler traces it and it works on a host with no filesystem.
 *
 * The environment holds WHO is being scanned: organizations, repositories,
 * handles, and real names. Those identify a company and its employees, and
 * pinning them in a committed file means they follow the repository anywhere it
 * goes, including into an open-source release. They belong in .env.local next
 * to the token, not in git.
 *
 * The CLI can also point at an entirely different file with SCAN_CONFIG_PATH;
 * see applyScanConfigOverride.
 */

let cached: ScanConfig | null = null;

function parse(raw: unknown, source: string): ScanConfig {
  const parsed = scanConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${source} is not valid:\n${issues}`);
  }
  return parsed.data;
}

/** "a, b ,c" -> ["a","b","c"]. Undefined when the variable is unset or blank. */
function list(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/**
 * Scope taken from the environment, overriding the committed file.
 *
 * Display names are JSON because they are a mapping, and inventing a second
 * delimiter syntax for one variable is worse than one line of JSON:
 *   GITHUB_USER_DISPLAY_NAMES='{"octocat":"Mona Lisa"}'
 */
function environmentScope(): Partial<ScanConfig> {
  const scope: Partial<ScanConfig> = {};

  const orgs = list(process.env.GITHUB_ORGS);
  const personalAccounts = list(process.env.GITHUB_USER_ACCOUNTS);
  const repos = list(process.env.GITHUB_REPOS);
  const users = list(process.env.GITHUB_USERS);
  const emails = list(process.env.GITHUB_AUTHOR_EMAILS);

  if (orgs) scope.organizations = orgs;
  if (personalAccounts) scope.personalAccounts = personalAccounts;
  if (repos) scope.repositories = repos;
  if (users) scope.githubUsernames = users;
  if (emails) scope.authorEmails = emails;

  const names = process.env.GITHUB_USER_DISPLAY_NAMES;
  if (names) {
    try {
      const parsed: unknown = JSON.parse(names);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        scope.userDisplayNames = parsed as Record<string, string>;
      }
    } catch {
      // A malformed mapping must not take the whole application down over a
      // cosmetic setting. Handles are shown instead of real names.
      console.warn("GITHUB_USER_DISPLAY_NAMES is not valid JSON, ignoring it.");
    }
  }

  return scope;
}

export function getScanConfig(): ScanConfig {
  cached ??= parse({ ...bundledConfig, ...environmentScope() }, "config/scan.json");
  return cached;
}

/**
 * Load an alternative config file named by SCAN_CONFIG_PATH.
 *
 * Called by the CLI scripts at startup, so a scheduled scan can target a
 * different scope without editing the committed default. It is async and
 * separate from getScanConfig so that node:fs is only ever imported from a
 * process that actually has a filesystem.
 */
export async function applyScanConfigOverride(): Promise<void> {
  const path = process.env.SCAN_CONFIG_PATH;
  if (!path) return;
  const { readFile } = await import("node:fs/promises");
  cached = parse(JSON.parse(await readFile(path, "utf8")), path);
}

/** Only for tests and the CLI scripts, which build a config in memory. */
export function overrideScanConfig(config: ScanConfig) {
  cached = config;
}

/**
 * Resolve the configured window to real dates.
 *
 * "today" is resolved at call time, never at load time. A long running process
 * that resolved it once at startup would freeze the end of its own reporting
 * period, and work pushed after that moment would stop appearing with nothing
 * to indicate why.
 */
export function resolvePeriod(config: ScanConfig, overrides?: { start?: string; end?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const startDay = overrides?.start || (config.startDate === "today" ? today : config.startDate);
  const endDay = overrides?.end || (config.endDate === "today" ? today : config.endDate);
  return {
    startDay,
    endDay,
    start: new Date(`${startDay}T00:00:00.000Z`),
    // Inclusive end: the caller means "through the end of this day".
    end: new Date(`${endDay}T23:59:59.999Z`),
  };
}

/**
 * A stable fingerprint of everything that changes which repositories and
 * branches a scan would discover. Keys the discovery cache, so changing the
 * repository list for one scope does not invalidate another's cache.
 */
export function scopeKey(config: ScanConfig): string {
  const branches = config.branches === "all" ? "all" : [...config.branches].sort().join(",");
  return JSON.stringify({
    orgs: [...config.organizations].sort(),
    users: [...config.personalAccounts].sort(),
    repos: [...config.repositories].sort(),
    branches,
  });
}
