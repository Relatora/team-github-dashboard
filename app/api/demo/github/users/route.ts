import { NextResponse } from "next/server";
import { getDemoStore } from "@/lib/store";
import { DEMO_DISPLAY_NAMES } from "@/lib/store/sqlite/report";

/** GET /api/demo/github/users - the demo roster. No auth check; see metrics/route.ts. */
export async function GET() {
  try {
    return NextResponse.json(await getDemoStore().getRoster(DEMO_DISPLAY_NAMES));
  } catch (error) {
    console.error("demo users", error);
    return NextResponse.json({ error: "Could not load the demo roster." }, { status: 500 });
  }
}
