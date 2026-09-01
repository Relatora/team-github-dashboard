import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { scanSchedule, type ScanScheduleRow } from "@/lib/db/schema";
import { computeNextRun } from "@/lib/schedule/next-run";
import { describeSchedule, DEFAULT_SCHEDULE, type Schedule, type ScheduleState } from "@/lib/schedule/types";
import { toCron } from "@/lib/schedule/cron";

/** The single schedule row. There is only ever one, with id 1. */
const ID = 1;

function toSchedule(row: ScanScheduleRow): Schedule {
  return {
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
}

export async function getScheduleRow(): Promise<ScanScheduleRow | null> {
  const rows = await getDb().select().from(scanSchedule).where(eq(scanSchedule.id, ID)).limit(1);
  return rows[0] ?? null;
}

/** The schedule plus everything the interface needs to describe it. */
export async function getScheduleState(): Promise<ScheduleState> {
  const row = await getScheduleRow();
  const schedule = row ? toSchedule(row) : DEFAULT_SCHEDULE;
  const { cron, note } = toCron(schedule);

  return {
    ...schedule,
    lastRunAt: row?.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
    lastStatus: row?.lastStatus ?? "",
    lastMessage: row?.lastMessage ?? "",
    nextRunAt: row?.nextRunAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? "",
    summary: describeSchedule(schedule),
    cron,
    cronNote: note,
  };
}

/**
 * Save the schedule and recompute when it next fires.
 *
 * nextRunAt is derived here rather than by the runner, so the modal can show
 * back the actual next time immediately and a mistake in the cadence is visible
 * before waiting for it not to happen.
 */
export async function saveSchedule(schedule: Schedule, updatedBy: string): Promise<ScheduleState> {
  const nextRunAt = computeNextRun(schedule);
  const now = new Date();

  const values = {
    id: ID,
    enabled: schedule.enabled,
    mode: schedule.mode,
    intervalValue: schedule.intervalValue,
    intervalUnit: schedule.intervalUnit,
    timesOfDay: schedule.timesOfDay,
    daysOfWeek: schedule.daysOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    timezone: schedule.timezone,
    windowMode: schedule.windowMode,
    windowDays: schedule.windowDays,
    nextRunAt,
    updatedAt: now,
    updatedBy,
  };

  await getDb()
    .insert(scanSchedule)
    .values(values)
    .onConflictDoUpdate({ target: scanSchedule.id, set: values });

  return getScheduleState();
}

/**
 * Record the outcome of a run and schedule the next one.
 *
 * lastSuccessAt only moves on success. That is what makes the
 * "since the last successful run" window safe: a failed run leaves the gap it
 * created for the next run to cover, instead of the marker sliding past data
 * that was never collected.
 */
export async function recordScheduledRun(
  status: "done" | "error",
  message: string,
  ranAt = new Date()
): Promise<void> {
  const row = await getScheduleRow();
  if (!row) return;

  const schedule = toSchedule(row);

  await getDb()
    .update(scanSchedule)
    .set({
      lastRunAt: ranAt,
      ...(status === "done" ? { lastSuccessAt: ranAt } : {}),
      lastStatus: status,
      lastMessage: message.slice(0, 500),
      nextRunAt: computeNextRun(schedule, ranAt),
    })
    .where(eq(scanSchedule.id, ID));
}

/** Claim the due slot before running, so a slow run cannot be started twice. */
export async function advanceNextRun(from = new Date()): Promise<void> {
  const row = await getScheduleRow();
  if (!row) return;

  await getDb()
    .update(scanSchedule)
    .set({ nextRunAt: computeNextRun(toSchedule(row), from) })
    .where(eq(scanSchedule.id, ID));
}
