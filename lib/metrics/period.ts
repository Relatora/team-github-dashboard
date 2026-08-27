/**
 * Turn dashboard filters into a concrete half-open date range.
 *
 * Ported from the date handling in GitHubController.js and filtersToDateRange
 * in GitHub.jsx, which had to agree with each other across two codebases.
 * Here there is one implementation, used by the metrics query and the report.
 */

export type PeriodFilters = {
  year?: string | number | null;
  month?: string | number | null;
  quarter?: string | number | null;
  /** Explicit YYYY-MM-DD range. Wins over year, month, and quarter. */
  start?: string | null;
  end?: string | null;
};

export type Period = {
  /** Inclusive lower bound. */
  start: Date;
  /** EXCLUSIVE upper bound. */
  end: Date;
  startDay: string;
  endDay: string;
} | null;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(value: string | null | undefined, addDays = 0): Date | null {
  const match = DAY_PATTERN.exec(String(value ?? ""));
  if (!match) return null;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3] + addDays));
  return Number.isNaN(date.getTime()) ? null : date;
}

const toDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Returns null for "all time", which is a real selection: the year filter has
 * an "All Years" option and it must not silently become the current year.
 *
 * The upper bound is exclusive throughout. A user picking "31 March" means
 * through the end of that day, so an inclusive end date becomes an exclusive
 * bound one day later. Comparing against the same day instead drops every
 * commit made after midnight on the last day of the range.
 */
export function resolvePeriodFilters(filters: PeriodFilters): Period {
  const start = parseDay(filters.start);
  const end = parseDay(filters.end, 1);
  if (start && end) {
    return { start, end, startDay: toDay(start), endDay: filters.end! };
  }

  const year = Number.parseInt(String(filters.year ?? ""), 10);
  if (Number.isNaN(year)) return null;

  const month = Number.parseInt(String(filters.month ?? ""), 10);
  const quarter = Number.parseInt(String(filters.quarter ?? ""), 10);

  let startMonth = 0;
  let endMonth = 12;

  // Month takes precedence over quarter, matching the source behaviour: the
  // dashboard shows only one of the two controls at a time, but a stale value
  // can still arrive in the query string.
  if (month >= 1 && month <= 12) {
    startMonth = month - 1;
    endMonth = month;
  } else if (quarter >= 1 && quarter <= 4) {
    startMonth = (quarter - 1) * 3;
    endMonth = startMonth + 3;
  }

  const periodStart = new Date(Date.UTC(year, startMonth, 1));
  const periodEnd = new Date(Date.UTC(year, endMonth, 1));

  return {
    start: periodStart,
    end: periodEnd,
    startDay: toDay(periodStart),
    // The reported end day is the last day IN the range, not the exclusive bound.
    endDay: toDay(new Date(periodEnd.getTime() - 86_400_000)),
  };
}
