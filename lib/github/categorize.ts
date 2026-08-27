/**
 * Classify a commit from its message.
 *
 * GitHub knows nothing about what a commit was for, so "Commits by Category"
 * is what tells a reader the shape of the work rather than only its volume.
 *
 * Ported from categorize_commit in github_work_report.py. The matching order
 * matters and is not arbitrary: see the chain in categorize() below.
 */

export const CATEGORIES = [
  "Fixes",
  "Removals & cleanup",
  "Features & additions",
  "Docs",
  "Build, config & CI",
  "Improvements & refactors",
  "Merges & branch sync",
  "Other changes",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Keyword table, in priority order. Order is load bearing.
 *
 * Fixes comes first so "fixed the add-button handler" is a fix rather than a
 * feature. Removals precedes Features for the same reason: "removed the new
 * export" is a removal. Improvements is last because its vocabulary is the
 * broadest and would otherwise swallow everything.
 */
const KEYWORDS: ReadonlyArray<readonly [Category, readonly string[]]> = [
  [
    "Fixes",
    ["fix", "fixed", "fixes", "fixing", "bug", "bugfix", "hotfix", "resolve", "resolved", "patch",
     "patched", "correct", "corrected", "repair", "prevent", "prevented", "handle", "handled",
     "handling", "solve", "solved", "workaround", "account", "accounted", "defect", "defective",
     "debug", "debugged"],
  ],
  [
    "Removals & cleanup",
    ["remove", "removed", "removing", "delete", "deleted", "drop", "dropped", "deprecate",
     "deprecated", "clean", "cleaned", "cleanup", "revert", "reverted", "disable", "disabled",
     "exclude", "excluded", "restrict", "restricted", "strip", "stripped", "discard", "discarded",
     "discarding", "eliminate", "eliminated", "eliminating", "trim", "trimmed", "prune", "pruned"],
  ],
  [
    "Features & additions",
    ["add", "added", "adding", "implement", "implemented", "introduce", "introduced", "create",
     "created", "new", "support", "enable", "enabled", "init", "initial", "initialize",
     "initialized", "first", "integrate", "integrated", "integrating", "integration", "complete",
     "completed", "finalize", "finalized", "finish", "finished", "start", "started", "setup",
     "scaffold", "scaffolded", "export", "exported", "import", "imported"],
  ],
  ["Docs", ["doc", "docs", "document", "documented", "readme", "comment", "comments"]],
  [
    "Build, config & CI",
    ["config", "configure", "build", "ci", "docker", "dockerfile", "pipeline", "workflow",
     "version", "dependency", "dependencies", "deps", "bump", "ignore", "env", "release", "chore",
     "deploy", "deployed", "deployment"],
  ],
  [
    "Improvements & refactors",
    ["refactor", "refactored", "improve", "improved", "update", "updated", "change", "changed",
     "modify", "modified", "modification", "optimize", "optimized", "optimise", "optimised",
     "rework", "reworked", "enhance", "enhanced", "adjust", "adjusted", "convert", "converted",
     "compact", "made", "move", "moved", "rename", "renamed", "wip", "attempt", "refine", "refined",
     "reformat", "reformated", "reformatted", "format", "formatted", "slim", "slimmed", "sort",
     "sorted", "separate", "separated", "separating", "switch", "switched", "replace", "replaced",
     "increase", "increased", "decrease", "decreased", "reduce", "reduced", "use", "used", "using",
     "set", "tweak", "tweaked", "tune", "tuned", "experiment", "experimented", "try", "tried",
     "trying", "test", "tested", "testing", "restructure", "restructured", "reorganize",
     "reorganized", "simplify", "simplified", "streamline", "streamlined", "standardize",
     "standardized", "consolidate", "consolidated", "migrate", "migrated", "upgrade", "upgraded",
     "extend", "extended", "expand", "expanded", "polish", "polished", "revise", "revised",
     "restore", "restored", "now", "getting", "make", "making", "work", "working", "worked"],
  ],
];

/** Punctuation stripped from the edges of a token before matching. */
const TRIM = /^[[\](){}<>:;,.#\-_/"']+|[[\](){}<>:;,.#\-_/"']+$/g;

const hasLetter = (word: string) => /[a-z]/i.test(word);

export function categorize(message: string): Category {
  const text = String(message ?? "").trim().toLowerCase();
  const rawWords = text.split(/\s+/).filter(Boolean);
  if (!rawWords.length) return "Other changes";

  // A merge is a merge regardless of what follows.
  if (rawWords[0] === "merge") return "Merges & branch sync";

  // Strip wrapping punctuation so "v0.1.8:", "[ticket-3]", and "chore:" surface
  // the verb inside them, then drop tokens with no letters at all, which
  // removes bare version numbers, dates, and hashes.
  const words = rawWords.map((w) => w.replace(TRIM, "")).filter((w) => w && hasLetter(w));
  if (!words.length) return "Other changes";

  // 1. The first real word. Commit messages here almost always start with a
  //    verb, and honouring it is what keeps "fixed ... add button" out of
  //    Features.
  const first = words[0];
  for (const [label, keywords] of KEYWORDS) {
    if (keywords.some((kw) => first.startsWith(kw))) return label;
  }

  // 2. The first word was not a known verb, so the message is version prefixed
  //    or noun led. Scan every word in the same priority order.
  for (const [label, keywords] of KEYWORDS) {
    if (words.some((w) => keywords.some((kw) => w.startsWith(kw)))) return label;
  }

  // 3. No keyword anywhere. Domain-noun messages such as "titration curve
  //    tweaks" are still real code changes, so they go to Improvements rather
  //    than a vague "Other changes" slice that hides the work on the dashboard.
  return "Improvements & refactors";
}

/**
 * Chart colours, fixed per category so a slice keeps its colour between
 * renders and between the screen and the exported PDF.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  "Features & additions": "#198754",
  Fixes: "#dc3545",
  "Improvements & refactors": "#0d6efd",
  "Removals & cleanup": "#fd7e14",
  "Build, config & CI": "#6f42c1",
  Docs: "#0dcaf0",
  "Merges & branch sync": "#6c757d",
  "Other changes": "#adb5bd",
  Uncategorized: "#ced4da",
};
