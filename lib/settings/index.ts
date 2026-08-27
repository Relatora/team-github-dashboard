import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema";

/**
 * Dashboard settings, resolved per user with an organization-wide fallback.
 *
 * Ported from AppSettingsController.js and the resolveDevSettings helper in
 * GitHub.jsx, which split this logic across the client and the server.
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
};

function coerce(raw: Record<string, unknown> | undefined): Partial<DevSettings> {
  if (!raw) return {};
  const out: Partial<DevSettings> = {};
  if (raw.calcMode === "raw" || raw.calcMode === "cleaned") out.calcMode = raw.calcMode;
  if (typeof raw.showRemoved === "boolean") out.showRemoved = raw.showRemoved;
  if (typeof raw.showIssues === "boolean") out.showIssues = raw.showIssues;
  if (Array.isArray(raw.shownUsers)) out.shownUsers = raw.shownUsers.map(String);
  return out;
}

/**
 * Personal override, then the global default, then the hardcoded defaults.
 *
 * An empty object is treated as absent, which is what makes "save for everyone"
 * work: it clears the acting user's personal row so the new global value is
 * actually visible to them.
 */
export async function resolveDevSettings(userEmail?: string | null): Promise<ResolvedDevSettings> {
  const emails = userEmail ? [GLOBAL_EMAIL, userEmail.toLowerCase()] : [GLOBAL_EMAIL];

  const rows = await getDb()
    .select()
    .from(appSettings)
    .where(and(inArray(appSettings.userEmail, emails), eq(appSettings.app, GITHUB_APP)));

  const global = coerce(rows.find((r) => r.userEmail === GLOBAL_EMAIL)?.devSettings);
  const personal = coerce(
    userEmail ? rows.find((r) => r.userEmail === userEmail.toLowerCase())?.devSettings : undefined
  );

  if (Object.keys(personal).length) {
    return { ...DEFAULT_DEV_SETTINGS, ...personal, source: "user" };
  }
  if (Object.keys(global).length) {
    return { ...DEFAULT_DEV_SETTINGS, ...global, source: "global" };
  }
  return { ...DEFAULT_DEV_SETTINGS, source: "default" };
}

/** Partial upsert: only the keys present are written, so saving one toggle keeps the rest. */
export async function saveSettings(
  userEmail: string,
  patch: { devSettings?: Record<string, unknown>; layout?: unknown[]; filters?: Record<string, unknown> }
): Promise<void> {
  const email = userEmail.toLowerCase();
  const now = new Date();

  const values = {
    userEmail: email,
    app: GITHUB_APP,
    devSettings: patch.devSettings ?? {},
    layout: patch.layout ?? [],
    filters: patch.filters ?? {},
    updatedAt: now,
  };

  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.devSettings !== undefined) set.devSettings = patch.devSettings;
  if (patch.layout !== undefined) set.layout = patch.layout;
  if (patch.filters !== undefined) set.filters = patch.filters;

  await getDb()
    .insert(appSettings)
    .values(values)
    .onConflictDoUpdate({
      target: [appSettings.userEmail, appSettings.app],
      set,
    });
}

/**
 * Write the organization-wide default AND clear the acting user's personal row.
 *
 * Clearing is not incidental. Without it the developer's own stale override
 * masks the global value they just set, so the toggle appears to do nothing for
 * the one person who can see it changed. That reads as a broken feature.
 */
export async function saveGlobalSettings(
  actingUserEmail: string | null,
  devSettings: Record<string, unknown>
): Promise<void> {
  await saveSettings(GLOBAL_EMAIL, { devSettings });
  if (actingUserEmail && actingUserEmail !== GLOBAL_EMAIL) {
    await saveSettings(actingUserEmail, { devSettings: {} });
  }
}
