import { HttpError, request, type Metrics, type ReportBody, type RosterUser, type Run } from "./github";

/**
 * Browser-side client for the public demo, mirroring lib/api/github.ts's
 * shapes exactly (both read from the same Metrics/RosterUser/Run types),
 * pointed at /api/demo/github/* instead of /api/github/*.
 *
 * Deliberately does not re-export startScan, addTrackedUsers, saveSettings,
 * or setGitHubToken: there is nothing under /api/demo to call them against,
 * and not importing them here is what keeps this module incapable of
 * mutating anything, independent of any prop or flag.
 */

export { HttpError };

export function getDemoMetrics(params: Record<string, string>): Promise<Metrics> {
  return request<Metrics>(`/api/demo/github/metrics?${new URLSearchParams(params)}`);
}

export function getDemoUsers(): Promise<RosterUser[]> {
  return request<RosterUser[]>("/api/demo/github/users");
}

export function getDemoRuns(limit = 1): Promise<Run[]> {
  return request<Run[]>(`/api/demo/github/runs?limit=${limit}`);
}

/** Returns Markdown, not JSON. A 409 means the scope has no demo data. */
export async function getDemoReport(body: ReportBody): Promise<string> {
  const response = await fetch("/api/demo/github/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new HttpError(response.status, "Could not build the demo report.", payload);
  }
  return response.text();
}
