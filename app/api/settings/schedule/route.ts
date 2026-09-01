import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/guard";
import { getScheduleState, saveSchedule } from "@/lib/db/repositories/schedule";
import { TIME_PATTERN } from "@/lib/schedule/types";

/** The recurring scan. Developer only: it spends the organization's API quota. */
export async function GET() {
  if (!(await requireApiRole("developer"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  return NextResponse.json(await getScheduleState());
}

const schema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["interval", "daily", "weekly", "monthly"]),
  // A ceiling as well as a floor: "every 0 days" would be a hot loop and
  // "every 9999 months" is a schedule that never fires.
  intervalValue: z.number().int().min(1).max(365),
  intervalUnit: z.enum(["hours", "days", "weeks", "months"]),
  timesOfDay: z.array(z.string().regex(TIME_PATTERN)).min(1).max(24),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  dayOfMonth: z.number().int().min(1).max(31),
  timezone: z.string().min(1).max(64),
  windowMode: z.enum(["rolling", "since-last-success", "full"]),
  windowDays: z.number().int().min(1).max(3650),
});

export async function PUT(request: Request) {
  const user = await requireApiRole("developer");
  if (!user) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid schedule." },
      { status: 400 }
    );
  }

  return NextResponse.json(await saveSchedule(parsed.data, user.email));
}
