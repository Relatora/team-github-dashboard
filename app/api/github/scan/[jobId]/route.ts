import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { getJob } from "@/lib/jobs/store";

/** GET /api/github/scan/[jobId] - poll a scan. */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!(await requireApiUser())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) {
    // A job the process no longer knows about. Most often the server restarted
    // mid-scan, or the job aged out of the store.
    return NextResponse.json({ error: "Unknown job." }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    message: job.message,
    counts: job.result?.counts,
    incomplete: job.result?.incomplete,
    warnings: job.result?.warnings,
  });
}
