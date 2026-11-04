/**
 * Dashboard settings types and defaults.
 *
 * Deliberately free of any database import, because the dashboard components
 * need these shapes and they run in the browser. Keeping them here is what
 * stops a client component pulling the whole data layer into the client bundle
 * just to name a type.
 *
 * The functions that read and write these live in ./index, which is server only.
 */

export const GITHUB_APP = "github-dashboard";

/** Reserved email holding the organization-wide default. */
export const GLOBAL_EMAIL = "__global__";

export type DevSettings = {
  /** Which line statistics the dashboard shows. */
  calcMode: "cleaned" | "raw";
  /** Lines Removed is hidden by default: it reliably confuses non-technical readers. */
  showRemoved: boolean;
  /** Whitelist of handles selectable in the Users control. Empty means no restriction. */
  shownUsers: string[];
  showIssues: boolean;
};

export const DEFAULT_DEV_SETTINGS: DevSettings = {
  calcMode: "cleaned",
  showRemoved: false,
  shownUsers: [],
  showIssues: true,
};

export type ResolvedDevSettings = DevSettings & {
  /** Where the effective values came from, so the interface can say so. */
  source: "user" | "global" | "default";
  /**
   * Whether any GitHub organization is configured for this deployment.
   * A personal-account-only scope has no "members" API to browse, so the
   * interface hides that entry point rather than showing a dialog whose
   * first act is a permission warning that does not apply.
   */
  hasOrganizations: boolean;
};

/** Narrow untrusted input to the known settings shape, dropping anything else. */
export function coerceDevSettings(raw: Record<string, unknown> | undefined): Partial<DevSettings> {
  if (!raw) return {};
  const out: Partial<DevSettings> = {};
  if (raw.calcMode === "raw" || raw.calcMode === "cleaned") out.calcMode = raw.calcMode;
  if (typeof raw.showRemoved === "boolean") out.showRemoved = raw.showRemoved;
  if (typeof raw.showIssues === "boolean") out.showIssues = raw.showIssues;
  if (Array.isArray(raw.shownUsers)) out.shownUsers = raw.shownUsers.map(String);
  return out;
}
