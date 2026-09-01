/**
 * Schedule shapes, free of any database or Node import so the modal can use
 * them in the browser.
 */

export type ScheduleMode = "interval" | "daily" | "weekly" | "monthly";
export type IntervalUnit = "hours" | "days" | "weeks" | "months";
export type WindowMode = "rolling" | "since-last-success" | "full";

export type Schedule = {
  enabled: boolean;
  mode: ScheduleMode;
  /** Used with intervalUnit when mode is "interval". */
  intervalValue: number;
  intervalUnit: IntervalUnit;
  /** "HH:mm", one or more. Several entries is how "a few times a day" is expressed. */
  timesOfDay: string[];
  /** 0 is Sunday, matching Date.getDay. */
  daysOfWeek: number[];
  dayOfMonth: number;
  /** IANA zone, so a time survives daylight saving. */
  timezone: string;
  windowMode: WindowMode;
  windowDays: number;
};

export type ScheduleState = Schedule & {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string;
  lastMessage: string;
  nextRunAt: string | null;
  updatedAt: string | null;
  updatedBy: string;
  /** Plain-English cadence, for the collapsed button. */
  summary: string;
  /** Equivalent cron line, or null when the cadence cannot be expressed in cron. */
  cron: string | null;
  /** Why cron cannot express it, when it cannot. */
  cronNote: string | null;
};

export const DEFAULT_SCHEDULE: Schedule = {
  enabled: false,
  mode: "daily",
  intervalValue: 1,
  intervalUnit: "days",
  timesOfDay: ["06:00"],
  daysOfWeek: [1],
  dayOfMonth: 1,
  timezone: "UTC",
  // Rolling by default: cheapest on API quota, and enrichment is incremental so
  // re-covering the same recent days costs almost nothing.
  windowMode: "rolling",
  windowDays: 30,
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Plain English, for the collapsed button and the modal header. */
export function describeSchedule(s: Schedule): string {
  if (!s.enabled) return "Off";

  const at = s.timesOfDay.length ? ` at ${[...s.timesOfDay].sort().join(", ")}` : "";

  switch (s.mode) {
    case "interval": {
      const unit = s.intervalValue === 1 ? s.intervalUnit.replace(/s$/, "") : s.intervalUnit;
      return `Every ${s.intervalValue} ${unit}`;
    }
    case "daily":
      return s.timesOfDay.length > 1 ? `Daily${at}` : `Daily${at}`;
    case "weekly": {
      const days = [...s.daysOfWeek].sort().map((d) => DAY_NAMES[d]?.slice(0, 3)).join(", ");
      return `Weekly on ${days || "Monday"}${at}`;
    }
    case "monthly":
      return `Monthly on day ${s.dayOfMonth}${at}`;
  }
}
