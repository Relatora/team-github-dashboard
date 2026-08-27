import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/guard";
import { startScanJob } from "@/lib/jobs/store";

const bodySchema = z.object({
  users: z.array(z.string()).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * POST /api/github/scan - start a scan in the background.
 *
 * Requires the developer role: a scan spends the organization's GitHub API
 * quota, so it is not something every viewer should be able to trigger.
 */
export async function POST(request: Request) {
  if (!(await requireApiRole("developer"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scan request." }, { status: 400 });
  }

  const job = startScanJob({
    users: parsed.data.users,
    startDate: parsed.data.start_date,
    endDate: parsed.data.end_date,
  });

  return NextResponse.json({ job_id: job.id, status: job.status });
}
