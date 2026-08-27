import type { GitHubClient } from "./client";
import { GitHubApiError, isRateLimitBudgetError } from "./errors";
import { categorize } from "./categorize";
import type { RawCommit } from "./types";
import type { RepoBranchMap } from "./discovery";
import type { ScanConfig } from "@/lib/config";
import type { NewCommitRow } from "@/lib/db/schema";

/**
 * Collect commits by walking every branch of every repository in the map.
 *
 * This uses the Commits API rather than commit search, and that is the single
 * most important decision in the file. GitHub's commit search index only covers
 * default branches, so any project that develops on `develop` or on feature
 * branches simply goes missing. Walking branches is why this tool sees work
 * that GitHub's own contribution graph does not.
 *
 * Ported from scan_commits in github_work_report.py.
 */

export type ScanResult = {
  commits: RawCommit[];
  /** Repositories fully processed this run, safe for a resumed run to skip. */
  completedRepos: Set<string>;
  /** True when the rate-limit guard halted the scan with partial results. */
  stoppedEarly: boolean;
  inaccessibleRepos: string[];
  staleBranches: number;
};

/**
 * Everything that identifies a person in a commit: GitHub logins, commit author
 * emails, and display names, lowercased.
 *
 * The email and name entries matter more than they look. A commit made with a
 * `git config user.email` that is not linked to the GitHub account has no
 * `author.login` at all, so login-only matching makes real work invisible.
 */
export function commitIdentities(config: ScanConfig): Set<string> {
  const ids = new Set<string>();
  for (const value of [...config.githubUsernames, ...config.authorEmails, ...config.authorNames]) {
    const trimmed = String(value).trim().toLowerCase();
    if (trimmed) ids.add(trimmed);
  }
  return ids;
}

export function commitMatchesIdentity(commit: RawCommit, identities: Set<string>): boolean {
  const login = commit.author?.login?.toLowerCase();
  if (login && identities.has(login)) return true;

  const author = commit.commit?.author;
  if (author?.email && identities.has(author.email.toLowerCase())) return true;
  if (author?.name && identities.has(author.name.toLowerCase())) return true;

  return false;
}

/** Map a raw commit onto the row shape, without statistics. */
export function toCommitRow(commit: RawCommit, repository: string): NewCommitRow {
  const gitAuthor = commit.commit?.author ?? {};
  // Only the subject line. The body is often long and adds nothing to a chart.
  const message = (commit.commit?.message ?? "").split("\n", 1)[0];
  const date = gitAuthor.date ? new Date(gitAuthor.date) : null;

  return {
    sha: commit.sha,
    repository: commit.repository?.full_name ?? repository,
    message,
    committedAt: date && !Number.isNaN(date.getTime()) ? date : null,
    authorLogin: commit.author?.login ?? "",
    authorName: gitAuthor.name ?? "",
    authorEmail: gitAuthor.email ?? "",
    category: categorize(message),
    url: commit.html_url ?? "",
    apiUrl: commit.url ?? "",
    isMerge: (commit.parents?.length ?? 0) >= 2,
    // Statistics stay undefined here. The upsert coalesces them, so a scan
    // without per-commit detail cannot overwrite values enrichment computed.
  };
}

export type ScanOptions = {
  client: GitHubClient;
  config: ScanConfig;
  start: Date;
  end: Date;
  repoBranches: RepoBranchMap;
  /** Repositories a previous run already finished, from the checkpoint. */
  skipRepos?: Set<string>;
  log?: (message: string) => void;
};

export async function scanCommits(options: ScanOptions): Promise<ScanResult> {
  const { client, config, start, end, repoBranches, log = console.error } = options;
  const skipRepos = options.skipRepos ?? new Set<string>();

  const empty: ScanResult = {
    commits: [],
    completedRepos: new Set(),
    stoppedEarly: false,
    inaccessibleRepos: [],
    staleBranches: 0,
  };

  const identities = commitIdentities(config);
  if (!identities.size) {
    log("No usernames configured, so there is nobody to scan for.");
    return empty;
  }
  if (!Object.keys(repoBranches).length) {
    log("No repositories to scan.");
    return empty;
  }

  /**
   * Ask GitHub for only each author's commits rather than downloading every
   * commit and filtering locally. On a busy branch this is the difference
   * between a handful of requests and paginating through everyone's history.
   *
   * Display names cannot be filtered server side, so if names are the only
   * configured identity we have to fall back to fetching everything.
   */
  const authorValues = [...config.githubUsernames, ...config.authorEmails]
    .map((v) => String(v).trim())
    .filter(Boolean);
  const useAuthorFilter = config.serverSideAuthorFilter && authorValues.length > 0;

  /**
   * GitHub answers 404 both for a repository the token cannot read and for a
   * branch deleted since the cache was written. Probe the repository once to
   * tell those apart, so a dead repository is skipped wholesale instead of
   * producing one 404 per branch.
   */
  const accessible = new Map<string, boolean>();
  async function repoIsAccessible(repo: string): Promise<boolean> {
    const known = accessible.get(repo);
    if (known !== undefined) return known;

    let result = true;
    try {
      await client.get(`/repos/${repo}`);
    } catch (error) {
      if (error instanceof GitHubApiError) result = error.status !== 404;
      // Anything else is transient or unknown, so do not write the repo off.
    }
    accessible.set(repo, result);
    return result;
  }

  async function commitsForBranch(repo: string, branch: string): Promise<RawCommit[]> {
    const base = { sha: branch, since: start.toISOString(), until: end.toISOString() };
    if (!useAuthorFilter) {
      return client.paged<RawCommit>(`/repos/${repo}/commits`, base, config.maxItemsPerSearch);
    }
    const out: RawCommit[] = [];
    for (const who of authorValues) {
      out.push(
        ...(await client.paged<RawCommit>(
          `/repos/${repo}/commits`,
          { ...base, author: who },
          config.maxItemsPerSearch
        ))
      );
    }
    return out;
  }

  const remaining = Object.keys(repoBranches).filter((r) => !skipRepos.has(r)).length;
  if (skipRepos.size) {
    log(`Resuming: skipping ${skipRepos.size} repositories already scanned, ${remaining} to go.`);
  }
  log(`Scanning ${remaining} repositories for commits by ${[...identities].sort().join(", ")}`);

  // Deduplicated by SHA, because the same commit appears on every branch that
  // contains it.
  const found = new Map<string, RawCommit>();
  const completedRepos = new Set<string>();
  const inaccessibleRepos: string[] = [];
  let staleBranches = 0;
  let stoppedEarly = false;
  let scanned = 0;

  for (const [repo, branches] of Object.entries(repoBranches)) {
    if (skipRepos.has(repo)) continue;

    let repoHits = 0;
    let repoDead = false;

    for (const branch of branches) {
      let commits: RawCommit[];
      try {
        commits = await commitsForBranch(repo, branch);
      } catch (error) {
        if (isRateLimitBudgetError(error)) {
          log(
            `${(error as Error).message} Stopping with partial results ` +
              `(${scanned} of ${remaining} repositories this run).`
          );
          stoppedEarly = true;
          break;
        }
        if (error instanceof GitHubApiError && error.status === 404) {
          if (!(await repoIsAccessible(repo))) {
            repoDead = true;
            break; // The whole repository is gone; stop trying its branches.
          }
          staleBranches += 1; // Only this branch is gone.
          continue;
        }
        log(`Could not read commits for ${repo}@${branch}: ${(error as Error).message}`);
        continue;
      }

      for (const commit of commits) {
        if (!commit.sha || found.has(commit.sha)) continue;
        if (!commitMatchesIdentity(commit, identities)) continue;
        // The commits list endpoint omits the repository on each item.
        commit.repository ??= { full_name: repo };
        found.set(commit.sha, commit);
        repoHits += 1;
      }
    }

    // A repository interrupted mid-way must not be marked complete, or a
    // resumed run skips it and its remaining branches are never scanned.
    if (stoppedEarly) break;

    completedRepos.add(repo);
    scanned += 1;

    if (repoDead) {
      inaccessibleRepos.push(repo);
      continue;
    }
    if (repoHits) {
      log(`  ${repo}: ${repoHits} matching commits across ${branches.length} branches`);
    }
  }

  if (staleBranches) {
    log(
      `Skipped ${staleBranches} deleted branches. Re-run with a branch rescan to prune the cache.`
    );
  }
  if (inaccessibleRepos.length) {
    const sample = inaccessibleRepos.slice(0, 5).join(", ");
    log(
      `Skipped ${inaccessibleRepos.length} inaccessible repositories ` +
        `(deleted, archived, or the token lacks access): ${sample}` +
        (inaccessibleRepos.length > 5 ? " ..." : "")
    );
  }

  return {
    commits: [...found.values()],
    completedRepos,
    stoppedEarly,
    inaccessibleRepos,
    staleBranches,
  };
}
