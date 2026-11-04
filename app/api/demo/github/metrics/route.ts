import { NextResponse } from "next/server";
import { getDemoStore } from "@/lib/store";
import type { CalcMode } from "@/lib/metrics/aggregate";

/**
 * GET /api/demo/github/metrics - the public demo, read from the isolated
 * SQLite dataset. No auth check: this route, and everything else under
 * /api/demo, is meant to be reachable by anyone. There is no equivalent
 * mutating route under this prefix - see app/demo/layout.tsx for why that,
 * not a role check, is what keeps this safe.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const calc: CalcMode = params.get("calc") === "raw" ? "raw" : "cleaned";

  try {
    const metrics = await getDemoStore().getMetrics({
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
    console.error("demo metrics", error);
    return NextResponse.json({ error: "Could not load demo metrics." }, { status: 500 });
  }
}
