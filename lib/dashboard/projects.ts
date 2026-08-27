import type { CountRow } from "@/components/charts";

/**
 * Roll repositories up into projects.
 *
 * Many systems ship as a client and server pair (agg_client and agg-server,
 * ts-client and ts-server). Charting them separately splits one project's work
 * across two bars and makes both look smaller than the thing actually is.
 *
 * Ported from consolidateByProject in GitHub.jsx.
 */

/** Friendly names for known bases. Anything else is title cased from the base. */
export const PROJECT_NAMES: Record<string, string> = {
  agg: "AGG Analysis",
  ts: "Ticketing System",
  "exp-info": "Experiment Information",
};

/** "agg_client" or "agg-server" -> "agg". Null when the name has no such suffix. */
export function repoBase(shortName: string): string | null {
  const match = /^(.*)-(client|server)$/.exec(shortName.toLowerCase().replace(/_/g, "-"));
  return match ? match[1] : null;
}

function titleCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Consolidate [{_id: "owner/name", count}] into project totals.
 *
 * Two rules that are easy to get wrong:
 *
 * 1. An unknown base is merged only when BOTH halves are present in the data.
 *    Otherwise a repository like `ap_sw_plc_server`, which has no matching
 *    client, would be relabelled "Ap Sw Plc" and lose its identity for no gain.
 *
 * 2. Call this with the FULL repository list, never a top-N slice. A pair whose
 *    halves each fall below the cutoff still totals above it, and slicing first
 *    would drop the project entirely.
 */
export function consolidateByProject(byRepo: CountRow[]): CountRow[] {
  const rows = byRepo.map((row) => {
    const short = String(row._id).split("/").pop() ?? String(row._id);
    return { short, base: repoBase(short), count: row.count };
  });

  // Which bases actually have more than one repository present.
  const halves = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.base) continue;
    const set = halves.get(row.base) ?? new Set<string>();
    set.add(row.short);
    halves.set(row.base, set);
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    const paired = row.base ? (halves.get(row.base)?.size ?? 0) > 1 : false;
    const label =
      (row.base && PROJECT_NAMES[row.base]) || (paired && row.base ? titleCase(row.base) : row.short);
    totals.set(label, (totals.get(label) ?? 0) + row.count);
  }

  return [...totals.entries()]
    .map(([label, count]) => ({ _id: label, count }))
    .sort((a, b) => b.count - a.count);
}

/** Handle to real name, falling back to the handle. Case insensitive. */
export function nameFrom(directory: Array<{ handle: string; name: string }>, handle: string): string {
  return (
    directory.find((u) => u.handle.toLowerCase() === String(handle).toLowerCase())?.name || handle
  );
}
