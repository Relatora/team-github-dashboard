import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { getMetrics, type CalcMode } from "@/lib/metrics/aggregate";

/**
 * GET /api/github/metrics
 *
 * Query: year, month, quarter, start, end, users (comma separated), repo, calc.
 * Shapes match what the charts expect: [{_id, count}] and
 * [{_id:{year,month}, count}].
 */
export async function GET(request: Request) {
  if (!(await requireApiUser())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const calc: CalcMode = params.get("calc") === "raw" ? "raw" : "cleaned";

  try {
    const metrics = await getMetrics({
      year: params.get("year"),
      month: params.get("month"),
      quarter: params.get("quarter"),
      start: params.get("start"),
      end: params.get("end"),
      repo: params.get("repo"),
      users: (params.get("users") ?? "").split(",").map((u) => u.trim()).filter(Boolean),
      calc,
    });
    return NextResponse.json(metrics);
  } catch (error) {
    console.error("metrics", error);
    return NextResponse.json({ error: "Could not load metrics." }, { status: 500 });
  }
}
