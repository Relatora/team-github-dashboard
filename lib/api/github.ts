import type { CountRow, TimeRow } from "@/components/charts";
import type { ResolvedDevSettings } from "@/lib/settings/types";

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

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
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

export type RosterUser = {
  handle: string;
  name: string;
  count: number;
  /** Deliberately tracked, rather than merely present in the commit data. */
  tracked: boolean;
  /** Tracked but never scanned, so a zero count means "unknown", not "nothing". */
  neverScanned: boolean;
};

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

/* ------------------------------------------------------- GitHub token ---- */

export type TokenStatus = {
  configured: boolean;
  source: "stored" | "environment" | "none";
  /** Last four characters only. The token itself never reaches the browser. */
  hint: string;
  label: string;
  updatedAt: string | null;
  updatedBy: string | null;
  ghCliAvailable: boolean;
};

export type TokenSaveResult = TokenStatus & {
  validated?: { login?: string; coreRemaining?: number; coreLimit?: number };
};

export function getGitHubTokenStatus(): Promise<TokenStatus> {
  return request<TokenStatus>("/api/settings/github-token");
}

export function setGitHubToken(
  input: { mode: "token"; token: string } | { mode: "gh-cli" }
): Promise<TokenSaveResult> {
  return request<TokenSaveResult>("/api/settings/github-token", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function clearGitHubToken(): Promise<TokenStatus> {
  return request<TokenStatus>("/api/settings/github-token", { method: "DELETE" });
}

/* ------------------------------------------------------ tracked users ---- */

export type TrackedUser = {
  handle: string;
  displayHandle: string;
  displayName: string;
  avatarUrl: string;
  addedAt: string;
  addedBy: string;
  lastScannedAt: string | null;
};

export function getTrackedUsers(): Promise<TrackedUser[]> {
  return request<TrackedUser[]>("/api/github/tracked-users");
}

/** Adds people to the roster. Deliberately does NOT scan them. */
export function addTrackedUsers(
  users: Array<{ handle: string; displayName?: string; avatarUrl?: string }>
): Promise<{ added: number; whitelistUpdated: boolean; users: TrackedUser[] }> {
  return request("/api/github/tracked-users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ users }),
  });
}

export function removeTrackedUsers(
  handles: string[]
): Promise<{ removed: number; users: TrackedUser[] }> {
  return request("/api/github/tracked-users", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handles }),
  });
}

/* ----------------------------------------------------------- schedule ---- */

export type { Schedule, ScheduleState } from "@/lib/schedule/types";

export function getSchedule(): Promise<import("@/lib/schedule/types").ScheduleState> {
  return request("/api/settings/schedule");
}

export function saveSchedule(
  schedule: import("@/lib/schedule/types").Schedule
): Promise<import("@/lib/schedule/types").ScheduleState> {
  return request("/api/settings/schedule", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schedule),
  });
}
