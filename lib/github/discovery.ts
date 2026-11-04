import { minimatch } from "minimatch";
import type { GitHubClient } from "./client";
import { isRateLimitBudgetError } from "./errors";
import { DEFAULT_LONG_LIVED_BRANCHES, type ScanConfig } from "@/lib/config";

/**
 * Repository and branch discovery.
 *
 * Listing every repository in an organization and every branch in each one is
 * the slow part of a scan and rarely changes between runs, so the result is
 * cached. Commits are always fetched live.
 *
 * Ported from resolve_scan_repos, list_branches, build_repo_branch_map, and
 * filter_scan_branches in github_work_report.py.
 */

export type RepoBranchMap = Record<string, string[]>;

/** Reuse the cached list, or re-list from the API. */
export type CacheMode = "cache" | "scan";

async function listOrgRepos(client: GitHubClient, org: string): Promise<string[]> {
  const repos = await client.paged<{ full_name: string; archived: boolean }>(
    `/orgs/${encodeURIComponent(org)}/repos`,
    { type: "all", sort: "full_name" }
  );
  return repos.map((r) => r.full_name).filter(Boolean);
}

/**
 * Repositories owned by a personal GitHub account.
 *
 * `GET /users/{login}/repos` only ever returns public repositories, even when
 * the token belongs to that same account. Seeing private repos requires the
 * authenticated `/user/repos` endpoint instead, which has no `login` in its
 * path and always means "whoever this token is". `selfLogin` (from
 * `preflight()`) is how the caller tells the two cases apart.
 */
async function listUserRepos(client: GitHubClient, login: string, selfLogin?: string): Promise<string[]> {
  const isSelf = Boolean(selfLogin) && login.toLowerCase() === selfLogin!.toLowerCase();
  const repos = isSelf
    ? await client.paged<{ full_name: string }>("/user/repos", {
        affiliation: "owner",
        visibility: "all",
        sort: "full_name",
      })
    : await client.paged<{ full_name: string }>(`/users/${encodeURIComponent(login)}/repos`, {
        type: "owner",
        sort: "full_name",
      });
  return repos.map((r) => r.full_name).filter(Boolean);
}

/**
 * Explicit repositories if configured, otherwise every repository in each
 * organization plus every repository owned by each configured personal
 * account. Org and personal-account scope are additive, not exclusive.
 */
export async function resolveRepos(
  client: GitHubClient,
  config: ScanConfig,
  log: (message: string) => void = console.error,
  selfLogin?: string
): Promise<string[]> {
  if (config.repositories.length) return [...config.repositories];

  const found: string[] = [];
  for (const org of config.organizations) {
    try {
      found.push(...(await listOrgRepos(client, org)));
    } catch (error) {
      if (isRateLimitBudgetError(error)) throw error;
      log(`Could not list repositories for ${org}: ${(error as Error).message}`);
    }
  }
  for (const account of config.personalAccounts) {
    try {
      found.push(...(await listUserRepos(client, account, selfLogin)));
    } catch (error) {
      if (isRateLimitBudgetError(error)) throw error;
      log(`Could not list repositories for ${account}: ${(error as Error).message}`);
    }
  }
  return found;
}

export async function listBranches(client: GitHubClient, repo: string): Promise<string[]> {
  const branches = await client.paged<{ name: string }>(`/repos/${repo}/branches`);
  return branches.map((b) => b.name).filter(Boolean);
}

/**
 * Assemble the repository to branches map from the cache, live discovery, or both.
 *
 * A repository that appears after a repository re-list but is absent from the
 * cache always has its branches listed live, whatever the branch mode says.
 * Otherwise a newly created repository would be discovered and then scanned
 * with an empty branch list, which reads as "this repository has no activity".
 */
export async function buildRepoBranchMap(
  client: GitHubClient,
  config: ScanConfig,
  cached: RepoBranchMap,
  modes: { repos: CacheMode; branches: CacheMode },
  log: (message: string) => void = console.error,
  selfLogin?: string
): Promise<RepoBranchMap> {
  const repos =
    modes.repos === "cache" && Object.keys(cached).length
      ? Object.keys(cached)
      : await resolveRepos(client, config, log, selfLogin);

  const explicitBranches = config.branches === "all" ? null : config.branches;
  const mapping: RepoBranchMap = {};
  let listed = 0;

  for (const [index, repo] of repos.entries()) {
    if (explicitBranches) {
      mapping[repo] = [...explicitBranches];
      continue;
    }
    if (modes.branches === "cache" && cached[repo]) {
      mapping[repo] = cached[repo];
      continue;
    }

    try {
      mapping[repo] = await listBranches(client, repo);
      listed += 1;
      if (listed % 25 === 0) log(`  listed branches for ${listed} repositories so far`);
    } catch (error) {
      if (isRateLimitBudgetError(error)) {
        // Stop discovery rather than keep hammering a spent quota, and fall
        // back to whatever the cache has for the rest so the scan can still
        // run over the repositories we do know about.
        log(`  ${(error as Error).message} Using cached branches for the remaining repositories.`);
        for (const rest of repos.slice(index)) {
          mapping[rest] ??= cached[rest] ?? [];
        }
        break;
      }
      log(`Could not list branches for ${repo}: ${(error as Error).message}`);
      mapping[repo] = [];
    }
  }

  return mapping;
}

/**
 * Trim each repository's branches to what will actually be scanned.
 *
 * "all" is complete coverage, including work that only exists on an unmerged
 * feature branch. "active" keeps long-lived branches only: far fewer API calls,
 * but it under-counts anyone whose work sits on an open pull request branch.
 * That is a rate-limit saver, not a setting to use when the numbers matter.
 *
 * Never mutates the input, so the cache keeps the full branch list.
 */
export function filterScanBranches(
  map: RepoBranchMap,
  config: ScanConfig
): { filtered: RepoBranchMap; before: number; after: number } {
  const before = Object.values(map).reduce((n, b) => n + b.length, 0);
  if (config.branchScanScope === "all") {
    return { filtered: { ...map }, before, after: before };
  }

  const patterns = (config.longLivedBranches.length
    ? config.longLivedBranches
    : DEFAULT_LONG_LIVED_BRANCHES
  ).map((p) => p.toLowerCase());

  const filtered: RepoBranchMap = {};
  for (const [repo, branches] of Object.entries(map)) {
    let keep = branches.filter((b) => patterns.some((p) => minimatch(b.toLowerCase(), p)));
    // Keep at least one branch so a repository whose branches follow no
    // recognized convention is not silently dropped from the report.
    if (!keep.length && branches.length) keep = [branches[0]];
    filtered[repo] = keep;
  }

  return { filtered, before, after: Object.values(filtered).reduce((n, b) => n + b.length, 0) };
}
