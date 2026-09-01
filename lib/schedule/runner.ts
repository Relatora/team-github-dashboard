import {
  advanceNextRun,
  getScheduleRow,
  recordScheduledRun,
} from "@/lib/db/repositories/schedule";
import { computeWindow } from "./next-run";
import type { Schedule } from "./types";
import { getActiveJob, startScanJob } from "@/lib/jobs/store";

/**
 * The scheduler.
 *
 * A one-minute ticker that asks the database whether a run is due and, if so,
 * starts one through the same job store the Refresh button uses. Reusing that
 * is deliberate: a scheduled scan and a clicked scan then cannot drift apart,
 * and the store already refuses to start a second scan while one is running,
 * which is exactly the overlap behaviour a scheduler needs.
 *
 * THE CONSTRAINT, the same one the job store carries: this lives in one
 * process. On a single long-lived server it is correct. On serverless it never
 * runs, and behind several instances every instance fires its own scan against
 * one shared rate-limit budget. The schedule modal says so and offers a cron
 * line for those deployments.
 */

const TICK_MS = 60_000;

/**
 * Module-level, because Next calls register() again on hot reload in
 * development. Two tickers would mean two scans racing for one quota, and the
 * symptom - scans stopping early on the rate limit for no apparent reason - is
 * nothing like the cause.
 */
let timer: NodeJS.Timeout | null = null;

function log(message: string) {
  console.log(`[scheduler] ${message}`);
}

async function tick(): Promise<void> {
  let row;
  try {
    row = await getScheduleRow();
  } catch {
    // The database can be briefly unreachable, for instance while a container
    // restarts. Skipping a tick is correct; crashing the server is not.
    return;
  }

  if (!row?.enabled || !row.nextRunAt) return;
  if (row.nextRunAt.getTime() > Date.now()) return;

  const active = getActiveJob();
  if (active && (active.status === "queued" || active.status === "running")) {
    // A previous scan is still going, which on a wide window is entirely
    // normal. Move the slot on rather than queueing work that would race it.
    log("A scan is already running; skipping this slot.");
    await advanceNextRun().catch(() => {});
    return;
  }

  const schedule: Schedule = {
    enabled: row.enabled,
    mode: row.mode as Schedule["mode"],
    intervalValue: row.intervalValue,
    intervalUnit: row.intervalUnit as Schedule["intervalUnit"],
    timesOfDay: row.timesOfDay,
    daysOfWeek: row.daysOfWeek,
    dayOfMonth: row.dayOfMonth,
    timezone: row.timezone,
    windowMode: row.windowMode as Schedule["windowMode"],
    windowDays: row.windowDays,
  };

  const window = computeWindow(schedule, row.lastSuccessAt ?? null);

  // Claim the slot BEFORE starting. A scan can run for many minutes, and
  // without this the next tick would see the same overdue time and start
  // another one.
  await advanceNextRun().catch(() => {});

  log(
    `Starting a scheduled scan${
      window.startDate ? ` for ${window.startDate} to ${window.endDate}` : " over the configured window"
    }.`
  );

  const job = startScanJob({ startDate: window.startDate, endDate: window.endDate });

  // Watch the job rather than awaiting it, so the ticker is never blocked.
  const watch = setInterval(() => {
    const current = getActiveJob();
    const finished = !current || current.id !== job.id;
    if (!finished && job.status !== "done" && job.status !== "error") return;

    clearInterval(watch);
    const status = job.status === "error" ? "error" : "done";
    recordScheduledRun(status, job.message).catch(() => {});
    log(`Scheduled scan ${status}: ${job.message}`);
  }, 5_000);
}

/**
 * Start the ticker. Safe to call more than once.
 *
 * An overdue nextRunAt at startup means the server was down through a slot, so
 * the first tick fires it. Silently skipping would leave a gap that nothing
 * ever fills, which is the failure mode of most hand-rolled schedulers.
 */
export function startScheduler(): void {
  if (timer) return;

  log("Started.");
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);

  // Do not hold the process open on this alone. Without unref, a CLI script
  // that imports anything reaching this module would never exit.
  timer.unref?.();

  // Check immediately as well, so a missed slot is picked up at startup rather
  // than up to a minute later.
  void tick();
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  log("Stopped.");
}
