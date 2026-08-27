import { minimatch } from "minimatch";

/**
 * Cleaned versus raw line statistics.
 *
 * This is the feature that makes the numbers defensible, and the one thing
 * GitHub's own Code Frequency graph will not do. Raw diffs count committed
 * node_modules and venv directories, regenerated lock files, minified bundles,
 * and merge commits, which re-show the entire diff they merged. On real data
 * the gap is not marginal: one author's year reads +178,796 cleaned against
 * +419,311 raw, so the raw figure is more than double and almost all noise.
 *
 * Both sets are computed from one API response and both are stored, so the
 * dashboard can switch between them without re-fetching anything.
 *
 * Ported from commit_stats and _path_is_ignored in github_work_report.py.
 */

/**
 * Bump when the computation changes, so one enrichment run reprocesses every
 * previously enriched commit under the new rules.
 *
 * Starts at 3 to match the source tool, whose version 3 introduced raw
 * statistics alongside cleaned. Keeping the number aligned means data imported
 * from the old database is correctly recognized as current rather than being
 * re-fetched from the API for no reason.
 */
export const STATS_VERSION = 3;

export type CommitFile = {
  filename?: string;
  additions?: number;
  deletions?: number;
};

export type CommitDetail = {
  parents?: unknown[];
  files?: CommitFile[];
};

export type CommitStats = {
  additions: number;
  deletions: number;
  filesChanged: number;
  additionsRaw: number;
  deletionsRaw: number;
  filesChangedRaw: number;
  isMerge: boolean;
};

/**
 * Should this changed file be excluded from the cleaned totals?
 *
 * Patterns ending in "/" match a directory name anywhere in the path, so
 * "node_modules/" catches both a top level and a nested copy. Everything else
 * is a glob, matched against the full path and against the basename, so
 * "*.min.js" works whether or not the file sits in a subdirectory.
 */
export function isIgnoredPath(filename: string, patterns: readonly string[]): boolean {
  const path = String(filename ?? "").toLowerCase().replace(/\\/g, "/");
  if (!path) return false;

  const base = path.split("/").pop() ?? path;
  const segments = path.split("/");

  for (const raw of patterns) {
    const pattern = String(raw).toLowerCase().trimEnd();
    if (pattern.endsWith("/")) {
      if (segments.includes(pattern.replace(/\/+$/, ""))) return true;
    } else if (minimatch(path, pattern) || minimatch(base, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Compute both statistic sets from one commit detail response.
 *
 * A merge commit has two or more parents and re-shows the diff of everything it
 * merged, double counting work already attributed to the commits on the source
 * branch. It contributes zero to the cleaned totals while keeping its full diff
 * in the raw ones. It is still counted as a commit and categorized under
 * "Merges & branch sync", because it did happen.
 */
export function commitStats(
  detail: CommitDetail | null | undefined,
  ignoreGlobs: readonly string[],
  excludeMerges = true
): CommitStats {
  const stats: CommitStats = {
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    additionsRaw: 0,
    deletionsRaw: 0,
    filesChangedRaw: 0,
    isMerge: false,
  };
  if (!detail || typeof detail !== "object") return stats;

  stats.isMerge = (detail.parents?.length ?? 0) >= 2;
  const skipEverything = excludeMerges && stats.isMerge;

  for (const file of detail.files ?? []) {
    const additions = Number(file.additions ?? 0) || 0;
    const deletions = Number(file.deletions ?? 0) || 0;

    stats.additionsRaw += additions;
    stats.deletionsRaw += deletions;
    stats.filesChangedRaw += 1;

    if (skipEverything) continue;
    if (isIgnoredPath(file.filename ?? "", ignoreGlobs)) continue;

    stats.additions += additions;
    stats.deletions += deletions;
    stats.filesChanged += 1;
  }

  return stats;
}
