import type { GitHubClient } from "./client";
import type { OrgMember } from "./types";
import type { ScanConfig } from "@/lib/config";

/**
 * List every member of the configured organizations.
 *
 * This is the one read that hits GitHub live rather than the database, and it
 * powers the developer picker for fetching someone not yet in the data.
 *
 * The permission trap worth knowing: /orgs/{org}/members returns an EMPTY 200,
 * not an error, when the token cannot see concealed membership. An empty picker
 * therefore looks like a bug and is actually a permission problem, so the
 * caller is told which case it is rather than being left to guess.
 *
 * Ported from resolve_org_members in github_work_report.py.
 */
export async function listOrgMembers(
  client: GitHubClient,
  config: ScanConfig
): Promise<{ members: OrgMember[]; warnings: string[] }> {
  const warnings: string[] = [];
  const byLogin = new Map<string, OrgMember>();

  if (!config.organizations.length) {
    warnings.push("No organizations are configured, so there is nobody to list.");
    return { members: [], warnings };
  }

  for (const org of config.organizations) {
    try {
      const members = await client.paged<OrgMember>(`/orgs/${encodeURIComponent(org)}/members`);
      if (!members.length) {
        warnings.push(
          `${org} returned no members. That is what GitHub does when the token cannot see ` +
            `concealed membership, rather than returning an error. A classic token needs ` +
            `read:org; a fine-grained token needs Organization > Members: Read and must have ` +
            `the organization itself as its resource owner.`
        );
      }
      for (const member of members) {
        if (member.login) byLogin.set(member.login.toLowerCase(), member);
      }
    } catch (error) {
      warnings.push(`Could not list members of ${org}: ${(error as Error).message}`);
    }
  }

  const members = [...byLogin.values()].sort((a, b) => a.login.localeCompare(b.login));
  return { members, warnings };
}
