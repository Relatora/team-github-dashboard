import { randomUUID } from "node:crypto";
import { runScan, type ScanOutcome, type ScanRequest } from "@/lib/github/run-scan";

/**
 * In-process store for background scans.
 *
 * A scan takes minutes, so the request that starts one returns a job id and the
 * dashboard polls it. This mirrors the job dictionary in the Python service.
 *
 * THE CONSTRAINT: this lives in the memory of one process. It works because
 * the application is meant to run as a long lived Node server (`next start`),
 * which is how the source service ran too. On a serverless platform, or behind
 * more than one instance, a job started by one worker is invisible to the next
 * poll and the dashboard waits forever on a job that is running fine somewhere
 * else.
 *
 * The upgrade path is a real queue (Redis, or a jobs table with a worker). It
 * is not built now because a single-team deployment does not need it, and
 * building it early would be guessing at the shape.
 */

export type JobStatus = "queued" | "running" | "done" | "error";

export type Job = {
  id: string;
  status: JobStatus;
  message: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: ScanOutcome;
};

const jobs = new Map<string, Job>();

/** Jobs older than this are dropped, so a long-lived process does not leak them. */
const RETENTION_MS = 60 * 60 * 1000;

/** Only one scan at a time: two concurrent scans race for the same rate-limit budget. */
let activeJobId: string | null = null;

function sweep() {
  const cutoff = Date.now() - RETENTION_MS;
  for (const [id, job] of jobs) {
    if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) jobs.delete(id);
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function getActiveJob(): Job | undefined {
  return activeJobId ? jobs.get(activeJobId) : undefined;
}

export function startScanJob(request: ScanRequest): Job {
  sweep();

  const active = getActiveJob();
  if (active && (active.status === "queued" || active.status === "running")) {
    // Returning the running job rather than refusing means a second click on
    // "Refresh data" attaches to the scan already in flight.
    return active;
  }

  const job: Job = {
    id: randomUUID(),
    status: "queued",
    message: "Queued",
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  activeJobId = job.id;

  // Deliberately not awaited: the caller gets the id immediately.
  void execute(job, request);

  return job;
}

async function execute(job: Job, request: ScanRequest): Promise<void> {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.message = "Starting";

  try {
    job.result = await runScan(request, (message) => {
      job.message = message;
      console.log(`[scan ${job.id.slice(0, 8)}] ${message}`);
    });
    job.status = "done";
    job.message = job.result.incomplete
      ? `Stored ${job.result.counts.commits} commits, stopped early on the rate limit.`
      : `Stored ${job.result.counts.commits} commits.`;
  } catch (error) {
    // A failed scan must never take the server down with it.
    job.status = "error";
    job.message = error instanceof Error ? error.message : String(error);
    console.error(`[scan ${job.id.slice(0, 8)}] failed`, error);
  } finally {
    job.finishedAt = new Date().toISOString();
    if (activeJobId === job.id) activeJobId = null;
  }
}
