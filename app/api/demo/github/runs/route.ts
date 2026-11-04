import { NextResponse } from "next/server";
import { getDemoStore } from "@/lib/store";

/** GET /api/demo/github/runs?limit= - when the demo dataset was generated. No auth check; see metrics/route.ts. */
export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 5);
  try {
    return NextResponse.json(await getDemoStore().listRuns(Number.isFinite(limit) ? limit : 5));
  } catch (error) {
    console.error("demo runs", error);
    return NextResponse.json({ error: "Could not load demo runs." }, { status: 500 });
  }
}
