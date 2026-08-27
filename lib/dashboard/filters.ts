/**
 * Dashboard filter state and the conversions the UI needs.
 *
 * Ported from the filter helpers in GitHub.jsx.
 */

export type Period = "month" | "quarter" | "year" | "custom";

export type Filters = {
  /** Empty string means "All Years". */
  year: number | "";
  period: Period;
  month: number | "";
  quarter: number | "";
  /** YYYY-MM-DD, used only when period is "custom". */
  startDate: string;
  endDate: string;
  /** Null while the roster is still loading, so it can initialise from it once. */
  users: string[] | null;
};

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

/** Local date to YYYY-MM-DD. Deliberately local, not UTC: a user picking a day means their day. */
export function ymd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The most recent Saturday at or before today. Used as the default start of the
 * custom range, matching how the team's reporting week is cut.
 */
export function lastSaturday(now = new Date()): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() - 6 + 7) % 7));
  return date;
}

const now = new Date();

export const DEFAULT_FILTERS: Filters = {
  year: now.getFullYear(),
  period: "month",
  month: now.getMonth() + 1,
  quarter: "",
  startDate: "",
  endDate: "",
  users: null,
};

/** Translate filters into the explicit range the report endpoint expects. */
export function filtersToDateRange(filters: Filters): { start_date?: string; end_date?: string } {
  if (filters.period === "custom") {
    if (filters.startDate && filters.endDate) {
      return { start_date: filters.startDate, end_date: filters.endDate };
    }
    return {};
  }

  // All Years: send no range at all rather than inventing one.
  if (!filters.year) return {};
  const year = Number(filters.year);

  if (filters.period === "month" && filters.month) {
    const month = Number(filters.month);
    const mm = String(month).padStart(2, "0");
    // Day 0 of the next month is the last day of this one, which handles
    // February and leap years without a table.
    const lastDay = new Date(year, month, 0).getDate();
    return {
      start_date: `${year}-${mm}-01`,
      end_date: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  if (filters.period === "quarter" && filters.quarter) {
    const ranges: Record<number, [string, string]> = {
      1: ["01-01", "03-31"],
      2: ["04-01", "06-30"],
      3: ["07-01", "09-30"],
      4: ["10-01", "12-31"],
    };
    const [from, to] = ranges[Number(filters.quarter)] ?? ["01-01", "12-31"];
    return { start_date: `${year}-${from}`, end_date: `${year}-${to}` };
  }

  return { start_date: `${year}-01-01`, end_date: `${year}-12-31` };
}

/** Human label for the current period, shown in the header and the PDF. */
export function periodLabel(filters: Filters): string {
  if (filters.period === "custom" && filters.startDate && filters.endDate) {
    return `${filters.startDate} to ${filters.endDate}`;
  }
  if (!filters.year) return "All time";
  if (filters.period === "month" && filters.month) {
    return `${MONTH_ABBR[Number(filters.month) - 1]} ${filters.year}`;
  }
  if (filters.period === "quarter" && filters.quarter) {
    return `${filters.year} Q${filters.quarter}`;
  }
  return String(filters.year);
}

/**
 * Apply a partial change, keeping the filter set internally consistent.
 *
 * Two adjustments the UI would otherwise have to remember at every call site:
 * choosing All Years clears the sub-period, because no sub-period is meaningful
 * without a year; and entering the custom range with no dates picks a sensible
 * default window rather than showing two empty pickers.
 */
export function applyFilterChange(previous: Filters, patch: Partial<Filters>): Filters {
  const next: Filters = { ...previous, ...patch };

  if (patch.year === "" && next.period !== "custom") {
    next.quarter = "";
    next.month = "";
    next.period = "year";
  }

  if (patch.period === "custom" && (!next.startDate || !next.endDate)) {
    next.startDate = ymd(lastSaturday());
    next.endDate = ymd(new Date());
  }

  return next;
}

/** Timestamp for export filenames: YYYY-MM-DD_HHMM. */
export function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}
