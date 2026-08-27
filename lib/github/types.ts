/** The subset of the GitHub commit payload this application reads. */
export type RawCommit = {
  sha: string;
  html_url?: string;
  url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
  };
  author?: { login?: string } | null;
  parents?: unknown[];
  stats?: { additions?: number; deletions?: number };
  files?: Array<{ filename?: string; additions?: number; deletions?: number }>;
  /** Not returned by the commits list endpoint; the scanner attaches it. */
  repository?: { full_name?: string };
};

/** The subset of the GitHub issue and pull request payload this application reads. */
export type RawIssue = {
  number?: number;
  title?: string;
  state?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  labels?: Array<{ name?: string }>;
  user?: { login?: string } | null;
};

export type OrgMember = {
  login: string;
  avatar_url?: string;
  html_url?: string;
};
