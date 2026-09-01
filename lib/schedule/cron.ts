import { TIME_PATTERN, type Schedule } from "./types";

/**
 * The equivalent cron line for a schedule, or an honest refusal.
 *
 * This exists because the in-app timer only works on a single long-lived
 * server. On serverless or behind several instances it either never fires or
 * fires once per instance, and the answer in that situation is to run the CLI
 * from the operating system's scheduler instead. Showing the cron line inside
 * the modal puts that answer where somebody will need it.
 *
 * Where cron genuinely cannot express a cadence, this returns null with a
 * reason rather than an approximation. A cron line that runs on the wrong days
 * is worse than no cron line, because it looks like it worked.
 */

export type CronEquivalent = {
  cron: string | null;
  note: string | null;
};

function parsedTimes(schedule: Schedule): Array<{ h: number; m: number }> {
  const parsed = schedule.timesOfDay
    .map((t) => TIME_PATTERN.exec(t.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ h: Number(m[1]), m: Number(m[2]) }));

  return parsed.length ? parsed : [{ h: 6, m: 0 }];
}

/**
 * Several times a day collapse into one line only when they share a minute:
 * cron has a single minute field, so 06:00 and 18:00 become "0 6,18 * * *",
 * while 06:00 and 18:30 cannot be one expression.
 */
function timeFields(times: Array<{ h: number; m: number }>): { minute: string; hour: string } | null {
  const minutes = new Set(times.map((t) => t.m));
  if (minutes.size > 1) return null;
  return {
    minute: String([...minutes][0]),
    hour: [...new Set(times.map((t) => t.h))].sort((a, b) => a - b).join(","),
  };
}

export function toCron(schedule: Schedule): CronEquivalent {
  const times = parsedTimes(schedule);

  switch (schedule.mode) {
    case "interval": {
      const n = Math.max(1, Math.floor(schedule.intervalValue));

      if (schedule.intervalUnit === "hours") {
        // Cron's step syntax restarts at midnight, so it only matches a true
        // "every N hours" when N divides 24 evenly. Otherwise the last interval
        // of each day is short and the schedules drift apart.
        if (24 % n !== 0) {
          return {
            cron: null,
            note: `Cron steps restart at midnight, so "every ${n} hours" cannot be expressed exactly. Use an interval that divides 24 (2, 3, 4, 6, 8, 12).`,
          };
        }
        return { cron: `0 */${n} * * *`, note: null };
      }

      if (schedule.intervalUnit === "days") {
        if (31 % n !== 0 && n !== 1) {
          return {
            cron: null,
            note: `Cron day steps restart each month, so "every ${n} days" drifts at the month boundary. Only every 1 day is exact.`,
          };
        }
        const fields = timeFields(times);
        if (!fields) return { cron: null, note: "Times with different minutes need one cron line each." };
        return { cron: `${fields.minute} ${fields.hour} */${n} * *`, note: null };
      }

      return {
        cron: null,
        note: `Cron has no concept of "every ${n} ${schedule.intervalUnit}". Use a weekly or monthly schedule, or run the CLI from a script that tracks its own interval.`,
      };
    }

    case "daily": {
      const fields = timeFields(times);
      if (!fields) {
        return { cron: null, note: "Times with different minutes need one cron line each." };
      }
      return { cron: `${fields.minute} ${fields.hour} * * *`, note: null };
    }

    case "weekly": {
      const fields = timeFields(times);
      if (!fields) {
        return { cron: null, note: "Times with different minutes need one cron line each." };
      }
      const days = (schedule.daysOfWeek.length ? schedule.daysOfWeek : [1]).sort((a, b) => a - b);
      return { cron: `${fields.minute} ${fields.hour} * * ${days.join(",")}`, note: null };
    }

    case "monthly": {
      const fields = timeFields(times);
      if (!fields) {
        return { cron: null, note: "Times with different minutes need one cron line each." };
      }
      const day = Math.min(Math.max(1, schedule.dayOfMonth), 31);
      const note =
        day > 28
          ? `Day ${day} does not exist in every month, and cron skips those months rather than clamping. The in-app schedule clamps to the last day instead.`
          : null;
      return { cron: `${fields.minute} ${fields.hour} ${day} * *`, note };
    }
  }
}

/** A ready-to-paste crontab line, including the command. */
export function cronLine(schedule: Schedule, projectDir = "/opt/team-github-dashboard"): string | null {
  const { cron } = toCron(schedule);
  if (!cron) return null;
  return `${cron} cd ${projectDir} && npm run scan >> /var/log/tgd-scan.log 2>&1`;
}

/**
 * The Windows equivalent.
 *
 * Task Scheduler has no interval concept beyond a repetition window, so this
 * covers the calendar modes and says so for the rest.
 */
export function taskSchedulerCommand(schedule: Schedule, projectDir = "C:\\path\\to\\project"): string | null {
  const times = parsedTimes(schedule);
  const first = times[0];
  const at = `${String(first.h).padStart(2, "0")}:${String(first.m).padStart(2, "0")}`;
  const action = `cmd /c cd /d "${projectDir}" && npm run scan`;
  const base = `schtasks /create /tn "TeamGitHubDashboard Scan" /tr "${action}"`;

  switch (schedule.mode) {
    case "daily":
      return `${base} /sc DAILY /st ${at}`;
    case "weekly": {
      const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const days = (schedule.daysOfWeek.length ? schedule.daysOfWeek : [1]).map((d) => names[d]).join(",");
      return `${base} /sc WEEKLY /d ${days} /st ${at}`;
    }
    case "monthly":
      return `${base} /sc MONTHLY /d ${Math.min(Math.max(1, schedule.dayOfMonth), 31)} /st ${at}`;
    case "interval":
      if (schedule.intervalUnit === "hours") {
        return `${base} /sc HOURLY /mo ${Math.max(1, schedule.intervalValue)}`;
      }
      if (schedule.intervalUnit === "days") {
        return `${base} /sc DAILY /mo ${Math.max(1, schedule.intervalValue)} /st ${at}`;
      }
      return null;
  }
}
