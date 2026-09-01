import { addDays, addHours, addMonths, addWeeks } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { TIME_PATTERN, type Schedule } from "./types";

/**
 * When the schedule should next fire.
 *
 * All wall-clock reasoning happens in the configured zone and is converted back
 * to an instant with date-fns-tz. Doing this by hand is the classic way to
 * write code that is correct for ten months and wrong for the two around a
 * daylight saving change: "06:00 tomorrow" is not always 24 hours away, and
 * adding 86,400,000 milliseconds quietly drifts the time by an hour twice a
 * year.
 *
 * Interval mode is different on purpose. "Every 6 hours" means six actual
 * hours, so it is measured from the previous run as elapsed time and does not
 * involve wall clocks at all.
 */

const MINUTE = 60_000;

function parseTime(value: string): { hours: number; minutes: number } | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/** Sorted, de-duplicated, always at least one entry so a schedule cannot be inert. */
function times(schedule: Schedule): Array<{ hours: number; minutes: number }> {
  const parsed = schedule.timesOfDay
    .map(parseTime)
    .filter((t): t is { hours: number; minutes: number } => t !== null);

  const unique = new Map(parsed.map((t) => [`${t.hours}:${t.minutes}`, t]));
  const sorted = [...unique.values()].sort((a, b) => a.hours - b.hours || a.minutes - b.minutes);

  return sorted.length ? sorted : [{ hours: 6, minutes: 0 }];
}

/**
 * The instant matching a wall-clock time on the given day in the schedule's
 * zone. `day` is a date already expressed in that zone.
 */
function instantFor(day: Date, time: { hours: number; minutes: number }, timezone: string): Date {
  const wall = new Date(day);
  wall.setHours(time.hours, time.minutes, 0, 0);
  return fromZonedTime(wall, timezone);
}

function validTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    // A zone the runtime does not recognise must not stop the scheduler; UTC is
    // wrong by at most a few hours, whereas throwing here stops scanning.
    return "UTC";
  }
}

export function computeNextRun(schedule: Schedule, from: Date = new Date()): Date | null {
  if (!schedule.enabled) return null;

  const timezone = validTimezone(schedule.timezone);

  if (schedule.mode === "interval") {
    const value = Math.max(1, Math.floor(schedule.intervalValue));
    switch (schedule.intervalUnit) {
      case "hours":
        return addHours(from, value);
      case "days":
        return addDays(from, value);
      case "weeks":
        return addWeeks(from, value);
      case "months":
        return addMonths(from, value);
    }
  }

  const slots = times(schedule);

  // A minute of slack, so a run that fires a few hundred milliseconds early
  // does not immediately schedule itself for the same slot again.
  const after = new Date(from.getTime() + MINUTE);

  const matchesDay = (day: Date): boolean => {
    if (schedule.mode === "daily") return true;
    if (schedule.mode === "weekly") {
      const days = schedule.daysOfWeek.length ? schedule.daysOfWeek : [1];
      return days.includes(day.getDay());
    }
    // Monthly. Clamp to the last day of short months, so "the 31st" still fires
    // in February rather than being skipped for seven months of the year.
    const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    return day.getDate() === Math.min(schedule.dayOfMonth, lastDay);
  };

  // Search forward day by day in the schedule's own zone. 400 days covers the
  // worst case (a monthly schedule just missed) with room to spare, and bounds
  // the loop so a nonsensical configuration cannot hang the server.
  const startOfSearch = toZonedTime(after, timezone);

  for (let offset = 0; offset < 400; offset++) {
    const day = addDays(startOfSearch, offset);
    if (!matchesDay(day)) continue;

    for (const time of slots) {
      const candidate = instantFor(day, time, timezone);
      if (candidate.getTime() > after.getTime() - MINUTE) return candidate;
    }
  }

  return null;
}

/**
 * The window a run should cover.
 *
 * "Since the last success" falls back to the rolling window when there is no
 * prior success, or the very first run would scan a zero-length period and find
 * nothing. Only a SUCCESSFUL run advances the marker, so a failure leaves the
 * gap it created to be filled by the next run rather than skipping over it.
 */
export function computeWindow(
  schedule: Schedule,
  lastSuccessAt: Date | null,
  now: Date = new Date()
): { startDate?: string; endDate?: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);

  if (schedule.mode === "interval" && schedule.windowMode === "rolling") {
    // Falls through to the same rolling logic below; kept explicit so the
    // interval case is obviously covered.
  }

  switch (schedule.windowMode) {
    case "full":
      // No range at all: runScan then uses the configured startDate to today.
      return {};

    case "since-last-success": {
      if (!lastSuccessAt) {
        const days = Math.max(1, schedule.windowDays);
        return { startDate: day(addDays(now, -days)), endDate: day(now) };
      }
      // One day of overlap. A commit pushed during the previous run, or one
      // amended just after it, would otherwise fall between two windows.
      return { startDate: day(addDays(lastSuccessAt, -1)), endDate: day(now) };
    }

    case "rolling":
    default: {
      const days = Math.max(1, schedule.windowDays);
      return { startDate: day(addDays(now, -days)), endDate: day(now) };
    }
  }
}
