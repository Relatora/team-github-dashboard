import type { CountRow, TimeRow } from "@/components/charts";
import type { ResolvedDevSettings } from "@/lib/settings";

/**
 * Browser-side API client.
 *
 * Ported from API/GitHub.js, which used axios. Plain fetch does the job and
 * removes a dependency; the only thing axios gave us that matters is a
 * distinguishable status on failure, which HttpError carries.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new HttpError(
      response.status,
      (body as { error?: string })?.error ?? `Request failed (${response.status})`,
      body
    );
  }
  return response.json() as Promise<T>;
}

export type Metrics = {
  users: string[];
  calc: "cleaned" | "raw";
  kpis: {
    commits: number;
    additions: number;
    deletions: number;
    files: number;
    repos: number;
    contributors: number;
    issues: number;
  };
  commitsOverTime: TimeRow[];
  linesOverTime: TimeRow[];
  byRepo: CountRow[];
  linesByRepo: CountRow[];
  byAuthor: CountRow[];
  linesByAuthor: CountRow[];
  byCategory: CountRow[];
};

export type RosterUser = { handle: string; name: string; count: number };

export type Run = {
  id: number;
  generatedAt: string;
  counts: Record<string, number>;
  incomplete: boolean;
  message: string | null;
};

export function getMetrics(params: Record<string, string>): Promise<Metrics> {
  return request<Metrics>(`/api/github/metrics?${new URLSearchParams(params)}`);
}

export function getUsers(): Promise<RosterUser[]> {
  return request<RosterUser[]>("/api/github/users");
}

export function getRuns(limit = 1): Promise<Run[]> {
  return request<Run[]>(`/api/github/runs?limit=${limit}`);
}

export function getOrgMembers(): Promise<{
  members: Array<{ login: string; avatar_url?: string; html_url?: string }>;
  warnings: string[];
}> {
  return request("/api/github/org-members");
}

export type ReportBody = {
  users: string[];
  audience?: "leadership" | "technical";
  calc?: "cleaned" | "raw";
  show_removed?: boolean;
  start_date?: string;
  end_date?: string;
};

/** Returns Markdown, not JSON. A 409 means the scope has no data yet. */
export async function getReport(body: ReportBody): Promise<string> {
  const response = await fetch("/api/github/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new HttpError(response.status, "Could not build the report.", payload);
  }
  return response.text();
}

export function startScan(body: {
  users?: string[];
  start_date?: string;
  end_date?: string;
}): Promise<{ job_id: string; status: string }> {
  return request("/api/github/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type ScanStatus = {
  status: "queued" | "running" | "done" | "error";
  message: string;
  counts?: Record<string, number>;
  incomplete?: boolean;
  warnings?: string[];
};

export function getScanStatus(jobId: string): Promise<ScanStatus> {
  return request<ScanStatus>(`/api/github/scan/${jobId}`);
}

export function getSettings(): Promise<ResolvedDevSettings> {
  return request<ResolvedDevSettings>("/api/settings");
}

export function saveSettings(
  scope: "me" | "everyone",
  devSettings: Partial<{
    calcMode: "cleaned" | "raw";
    showRemoved: boolean;
    showIssues: boolean;
    shownUsers: string[];
  }>
): Promise<ResolvedDevSettings> {
  return request<ResolvedDevSettings>("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, devSettings }),
  });
}
