import { CATEGORIES } from "@/lib/github/categorize";
import type { CalcMode } from "@/lib/metrics/aggregate";

/**
 * Render the work report as Markdown.
 *
 * Two audiences from one dataset. Leadership gets plain English grouped by the
 * kind of work; technical gets per-commit detail with SHAs and line counts.
 *
 * Ported from write_markdown_report in github_work_report.py.
 */

export type ReportCommit = {
  sha: string;
  repository: string;
  message: string;
  /** YYYY-MM-DD, or empty when the commit has no usable date. */
  day: string;
  category: string;
  url: string;
  /** Null when the commit has not been enriched. Not the same as zero. */
  additions: number | null;
  deletions: number | null;
  filesChanged: number | null;
};

export type ReportData = {
  commits: ReportCommit[];
  issueCount: number;
  users: string[];
  displayNames: Record<string, string>;
  periodStart: string;
  periodEnd: string;
  audience: "leadership" | "technical";
  calc: CalcMode;
  showRemoved: boolean;
  includeIssues: boolean;
  notes: string[];
};

type RepoAggregate = {
  count: number;
  additions: number;
  deletions: number;
  files: number;
  hasStats: boolean;
  first: string;
  last: string;
};

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, word: string) => `${n(count)} ${word}${count === 1 ? "" : "s"}`;

/** Escape a pipe so a commit message cannot break out of a Markdown table cell. */
const cell = (text: string) => text.replace(/\|/g, "\\|");

function aggregateByRepo(commits: ReportCommit[]): Map<string, RepoAggregate> {
  const agg = new Map<string, RepoAggregate>();

  for (const commit of commits) {
    const repo = commit.repository || "Unknown";
    const entry = agg.get(repo) ?? {
      count: 0,
      additions: 0,
      deletions: 0,
      files: 0,
      hasStats: false,
      first: "",
      last: "",
    };

    entry.count += 1;
    // hasStats is driven by additions specifically, because null means "never
    // enriched". A repository of merge commits legitimately totals zero lines
    // and must still count as having statistics.
    if (commit.additions !== null) {
      entry.additions += commit.additions;
      entry.hasStats = true;
    }
    if (commit.deletions !== null) entry.deletions += commit.deletions;
    if (commit.filesChanged !== null) entry.files += commit.filesChanged;

    if (commit.day) {
      if (!entry.first || commit.day < entry.first) entry.first = commit.day;
      if (!entry.last || commit.day > entry.last) entry.last = commit.day;
    }

    agg.set(repo, entry);
  }

  return agg;
}

function monthlyCounts(commits: ReportCommit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    if (commit.day.length < 7) continue;
    const month = commit.day.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Group one repository's messages by category, newest first, collapsing repeats
 * into a count. Ten commits reading "wip" should be one line, not ten.
 */
function categorizedMessages(rows: ReportCommit[]): Map<string, string[]> {
  const seen = new Map<string, Map<string, number>>();
  const order = new Map<string, string[]>();

  for (const row of [...rows].sort((a, b) => b.day.localeCompare(a.day))) {
    const message = row.message.trim();
    if (!message) continue;

    const bucket = seen.get(row.category) ?? new Map<string, number>();
    if (!bucket.has(message)) {
      order.set(row.category, [...(order.get(row.category) ?? []), message]);
    }
    bucket.set(message, (bucket.get(message) ?? 0) + 1);
    seen.set(row.category, bucket);
  }

  const result = new Map<string, string[]>();
  for (const [category, messages] of order) {
    const counts = seen.get(category)!;
    result.set(
      category,
      messages.map((m) => {
        const count = counts.get(m)!;
        return count > 1 ? `${m} (x${count})` : m;
      })
    );
  }
  return result;
}

/** Longest commit list shown per category before it is truncated. */
const MAX_MESSAGES_PER_CATEGORY = 15;

export function renderMarkdown(data: ReportData): string {
  const technical = data.audience === "technical";
  const out: string[] = [];

  const repoAgg = aggregateByRepo(data.commits);
  const months = monthlyCounts(data.commits);
  const hasStats = [...repoAgg.values()].some((a) => a.hasStats);
  const totalAdds = [...repoAgg.values()].reduce((s, a) => s + a.additions, 0);
  const totalDels = [...repoAgg.values()].reduce((s, a) => s + a.deletions, 0);
  const totalFiles = [...repoAgg.values()].reduce((s, a) => s + a.files, 0);

  const linesPhrase = data.showRemoved ? `+${n(totalAdds)} / -${n(totalDels)}` : `+${n(totalAdds)}`;

  // --- Header ---------------------------------------------------------------
  out.push(`# ${technical ? "GitHub Technical Activity Report" : "GitHub Work Summary"}`);
  out.push("");
  out.push(
    `**GitHub user${data.users.length === 1 ? "" : "s"}:** ` +
      (data.users.map((u) => `\`${u}\``).join("  ") || "`(none)`") +
      "  "
  );

  const lower = new Map(
    Object.entries(data.displayNames).map(([handle, name]) => [handle.toLowerCase(), name])
  );
  const named = data.users
    .map((u) => [u, lower.get(u.toLowerCase())] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]));
  if (named.length) {
    // Pair each name with its handle so several people stay unambiguous.
    const line =
      data.users.length === 1
        ? named[0][1]
        : named.map(([handle, name]) => `${name} (\`${handle}\`)`).join(", ");
    out.push(`**Name${named.length === 1 ? "" : "s"}:** ${line}  `);
  }

  out.push(`**Reporting period:** ${data.periodStart} to ${data.periodEnd}  `);
  out.push(`**Audience:** ${technical ? "Technical / engineering" : "Leadership / management"}  `);
  if (hasStats) {
    // State the counting mode. A reader comparing this against GitHub's own
    // numbers needs to know which one they are looking at.
    out.push(
      `**Line counting:** ${
        data.calc === "raw"
          ? "raw GitHub diff totals, including generated files and merge commits"
          : "cleaned, excluding generated and vendored files and merge commits"
      }  `
    );
  }
  out.push(`**Generated at:** ${new Date().toISOString()}`);
  out.push("");

  // --- Executive summary ----------------------------------------------------
  const repoCount = repoAgg.size;
  const span = months.size ? `${[...months.keys()][0]} through ${[...months.keys()].pop()}` : "";

  out.push("## Executive Summary");
  out.push("");
  let sentence =
    `Across **${repoCount} project${repoCount === 1 ? "" : "s"}** in the reporting period` +
    (span ? ` (${span})` : "") +
    `, this work comprised **${plural(data.commits.length, "commit")}**`;
  if (hasStats) {
    sentence += ` totaling **${linesPhrase} lines** across **${plural(totalFiles, "file change")}**`;
  }
  if (data.includeIssues && data.issueCount) {
    sentence += `, plus **${plural(data.issueCount, "issue")} opened**`;
  }
  out.push(`${sentence}.`);
  out.push("");

  out.push("| Metric | Count |");
  out.push("|---|---:|");
  out.push(`| Commits authored | ${n(data.commits.length)} |`);
  out.push(`| Projects (repositories) worked in | ${n(repoCount)} |`);
  if (hasStats) {
    out.push(`| Lines added | +${n(totalAdds)} |`);
    if (data.showRemoved) out.push(`| Lines removed | -${n(totalDels)} |`);
    out.push(`| File changes | ${n(totalFiles)} |`);
  }
  out.push(`| Active months | ${n(months.size)} |`);
  if (data.includeIssues) out.push(`| Issues opened | ${n(data.issueCount)} |`);
  out.push("");

  if (data.notes.length && !technical) {
    out.push("## Manual Impact Notes");
    out.push("");
    for (const note of data.notes) out.push(`- ${note}`);
    out.push("");
  }

  // --- Work by project ------------------------------------------------------
  out.push("## Work by Project");
  out.push("");
  if (!repoAgg.size) {
    out.push("No commit activity found in the reporting period.");
    out.push("");
  } else {
    const linesHeader = data.showRemoved ? "Lines (+/-)" : "Lines (+)";
    out.push(
      hasStats
        ? `| Project | Commits | ${linesHeader} | Files | Active |`
        : "| Project | Commits | Active |"
    );
    out.push(hasStats ? "|---|---:|---|---:|---|" : "|---|---:|---|");

    for (const [repo, agg] of [...repoAgg.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const active = agg.first === agg.last ? agg.first : `${agg.first} to ${agg.last}`;
      const short = repo.split("/").pop() ?? repo;
      if (hasStats) {
        const cellLines = data.showRemoved
          ? `+${n(agg.additions)} / -${n(agg.deletions)}`
          : `+${n(agg.additions)}`;
        out.push(`| \`${short}\` | ${agg.count} | ${cellLines} | ${n(agg.files)} | ${active} |`);
      } else {
        out.push(`| \`${short}\` | ${agg.count} | ${active} |`);
      }
    }
    out.push("");
  }

  // --- Activity by month ----------------------------------------------------
  if (months.size) {
    const peak = Math.max(...months.values());
    out.push("## Activity by Month");
    out.push("");
    out.push("| Month | Commits | |");
    out.push("|---|---:|---|");
    for (const [month, count] of months) {
      const bar = peak ? "#".repeat(Math.max(1, Math.round((count / peak) * 20))) : "";
      out.push(`| ${month} | ${count} | ${bar} |`);
    }
    out.push("");
  }

  // --- Detail ---------------------------------------------------------------
  const byRepo = new Map<string, ReportCommit[]>();
  for (const commit of data.commits) {
    const repo = commit.repository || "Unknown";
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), commit]);
  }
  const sortedRepos = [...byRepo.entries()].sort(([a], [b]) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  if (technical) {
    out.push("## Commits by Project");
    out.push("");
    if (!data.commits.length) {
      out.push("No matching commits found.");
      out.push("");
    }
    for (const [repo, rows] of sortedRepos) {
      const agg = repoAgg.get(repo)!;
      out.push(`### \`${repo}\``);
      out.push("");
      let summary = plural(agg.count, "commit");
      if (agg.hasStats) {
        const linesStr = data.showRemoved
          ? `+${n(agg.additions)} / -${n(agg.deletions)}`
          : `+${n(agg.additions)}`;
        summary += ` - ${linesStr} lines - ${plural(agg.files, "file change")}`;
      }
      out.push(`_${summary}_`);
      out.push("");
      out.push(hasStats ? "| Date | SHA | Message | +/- | Files | Link |" : "| Date | SHA | Message | Link |");
      out.push(hasStats ? "|---|---|---|---|---:|---|" : "|---|---|---|---|");

      for (const row of [...rows].sort((a, b) => b.day.localeCompare(a.day))) {
        const short = row.sha.slice(0, 12);
        const link = row.url ? `[${short}](${row.url})` : short;
        if (hasStats) {
          const change =
            row.additions !== null && row.deletions !== null
              ? `+${row.additions}/-${row.deletions}`
              : "";
          out.push(
            `| ${row.day} | \`${short}\` | ${cell(row.message)} | ${change} | ${row.filesChanged ?? ""} | ${link} |`
          );
        } else {
          out.push(`| ${row.day} | \`${short}\` | ${cell(row.message)} | ${link} |`);
        }
      }
      out.push("");
    }
  } else {
    out.push("## What I Worked On");
    out.push("");
    out.push("Each project below summarizes the actual changes committed, grouped by the kind of work.");
    out.push("");
    if (!data.commits.length) {
      out.push("No matching commits found.");
      out.push("");
    }
    for (const [repo, rows] of sortedRepos) {
      const agg = repoAgg.get(repo)!;
      out.push(`### ${repo.split("/").pop() ?? repo}`);
      out.push("");
      let summary = plural(agg.count, "commit");
      if (agg.first) {
        summary += ` - ${agg.first}${agg.last !== agg.first ? ` to ${agg.last}` : ""}`;
      }
      if (agg.hasStats) {
        summary += data.showRemoved
          ? ` - +${n(agg.additions)} / -${n(agg.deletions)} lines`
          : ` - +${n(agg.additions)} lines`;
      }
      out.push(`_${summary}_`);
      out.push("");

      const categorized = categorizedMessages(rows);
      // Fixed category order, so two reports are comparable side by side.
      for (const category of CATEGORIES) {
        const messages = categorized.get(category);
        if (!messages?.length) continue;
        out.push(`- **${category} (${messages.length}):**`);
        for (const message of messages.slice(0, MAX_MESSAGES_PER_CATEGORY)) {
          out.push(`    - ${message}`);
        }
        if (messages.length > MAX_MESSAGES_PER_CATEGORY) {
          out.push(`    - and ${messages.length - MAX_MESSAGES_PER_CATEGORY} more`);
        }
      }
      out.push("");
    }
  }

  return out.join("\n");
}
