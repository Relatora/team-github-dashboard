import { readFileSync } from "node:fs";
import path from "node:path";
import { scanConfigSchema, type ScanConfig } from "./schema";

export * from "./schema";

const CONFIG_FILE = process.env.SCAN_CONFIG_PATH ?? "config/scan.json";

let cached: ScanConfig | null = null;

/**
 * The scan scope: which people, which organizations, which branches, and how
 * aggressively to spend API quota. Replaces gitHubConfig.yaml from the Python
 * tool.
 *
 * It lives in a committed JSON file rather than environment variables because
 * it is not secret, it is structured, and a reviewer should be able to see in
 * git when the tracked roster changed. Secrets stay in the environment; see
 * ./env.
 */
export function getScanConfig(): ScanConfig {
  if (cached) return cached;

  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(path.join(process.cwd(), CONFIG_FILE), "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      throw new Error(`Could not read ${CONFIG_FILE}: ${(error as Error).message}`);
    }
    // A missing file is fine: every field has a default, so an unconfigured
    // install still starts and shows an empty dashboard rather than crashing.
  }

  const parsed = scanConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${CONFIG_FILE} is not valid:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Only for tests and the CLI scripts, which build a config in memory. */
export function overrideScanConfig(config: ScanConfig) {
  cached = config;
}

/**
 * Resolve the configured window to real dates. "today" is resolved at call
 * time, never at load time, so a long running process does not freeze the end
 * of its own reporting period.
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
 * branches a scan would discover. Used to key the discovery cache so changing
 * the repository list for one scope does not invalidate another.
 */
export function scopeKey(config: ScanConfig): string {
  const branches = config.branches === "all" ? "all" : [...config.branches].sort().join(",");
  return JSON.stringify({
    orgs: [...config.organizations].sort(),
    repos: [...config.repositories].sort(),
    branches,
  });
}
