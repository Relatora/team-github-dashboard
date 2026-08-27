import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { getUsers } from "@/lib/metrics/aggregate";
import { latestDisplayNames } from "@/lib/db/repositories/items";

/** GET /api/github/users - the dynamic roster: [{ handle, name, count }]. */
export async function GET() {
  if (!(await requireApiUser())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    return NextResponse.json(await getUsers(await latestDisplayNames()));
  } catch (error) {
    console.error("users", error);
    return NextResponse.json({ error: "Could not load the roster." }, { status: 500 });
  }
}
