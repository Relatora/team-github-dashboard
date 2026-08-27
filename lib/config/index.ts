import { scanConfigSchema, type ScanConfig } from "./schema";
import bundledConfig from "@/config/scan.json";

export * from "./schema";

/**
 * The scan scope: which people, which organizations, which branches, and how
 * aggressively to spend API quota. Replaces gitHubConfig.yaml from the Python
 * tool.
 *
 * It lives in a committed JSON file rather than in environment variables
 * because it is not secret, it is structured, and a reviewer should be able to
 * see in git history when the tracked roster changed. Secrets stay in the
 * environment; see ./env.
 *
 * The file is imported rather than read from disk, so the bundler traces it and
 * it works on a host with no filesystem. The CLI scripts can point at a
 * different file with SCAN_CONFIG_PATH by awaiting applyScanConfigOverride
 * before doing anything else; that path is deliberately not available to the
 * server, which should run the configuration that was deployed with it.
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

export function getScanConfig(): ScanConfig {
  cached ??= parse(bundledConfig, "config/scan.json");
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
    repos: [...config.repositories].sort(),
    branches,
  });
}
