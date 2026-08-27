import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/guard";
import { GitHubClient } from "@/lib/github/client";
import { listOrgMembers } from "@/lib/github/org";
import { getScanConfig } from "@/lib/config";
import { resolveGitHubToken } from "@/lib/config/env";

/**
 * GET /api/github/org-members
 *
 * The only read that hits GitHub live. Developer role only, since it both
 * spends API quota and exposes the organization roster.
 */
export async function GET() {
  if (!(await requireApiRole("developer"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const config = getScanConfig();
  const client = new GitHubClient({
    token: resolveGitHubToken(),
    apiBase: config.githubApiBase,
    minRemaining: config.rateLimitMinRemaining,
    rateLimitAction: config.rateLimitAction,
  });

  try {
    // Warnings travel with the response rather than only to the log, because
    // the most common failure here is a permission problem that GitHub reports
    // as an empty success. The picker must be able to explain itself.
    const { members, warnings } = await listOrgMembers(client, config);
    return NextResponse.json({ members, warnings });
  } catch (error) {
    console.error("org-members", error);
    return NextResponse.json(
      { error: "Could not reach GitHub to list organization members." },
      { status: 502 }
    );
  }
}
