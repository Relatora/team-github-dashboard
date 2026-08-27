import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { listRuns } from "@/lib/db/repositories/items";

/** GET /api/github/runs?limit= - recent scans, for the "Last synced" line. */
export async function GET(request: Request) {
  if (!(await requireApiUser())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 5);
  try {
    return NextResponse.json(await listRuns(Number.isFinite(limit) ? limit : 5));
  } catch (error) {
    console.error("runs", error);
    return NextResponse.json({ error: "Could not load runs." }, { status: 500 });
  }
}
