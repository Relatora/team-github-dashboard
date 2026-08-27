import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth/guard";
import { buildReport, NoDataError } from "@/lib/report/build";

const bodySchema = z.object({
  users: z.array(z.string()).default([]),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  year: z.union([z.string(), z.number()]).optional(),
  month: z.union([z.string(), z.number()]).optional(),
  quarter: z.union([z.string(), z.number()]).optional(),
  audience: z.enum(["leadership", "technical"]).default("leadership"),
  calc: z.enum(["cleaned", "raw"]).default("cleaned"),
  show_removed: z.boolean().default(true),
});

/**
 * POST /api/github/report - the narrative report, built from stored data.
 *
 * Returns 409 with { needs_scan: true } when the scope holds no commits, so the
 * dashboard can offer a scan instead of showing a failure. That distinction
 * matters: "nobody has scanned this yet" and "something broke" call for
 * completely different actions from the reader.
 */
export async function POST(request: Request) {
  if (!(await requireApiUser())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid report request." }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const markdown = await buildReport({
      users: body.users,
      start: body.start_date,
      end: body.end_date,
      year: body.year,
      month: body.month,
      quarter: body.quarter,
      audience: body.audience,
      calc: body.calc,
      showRemoved: body.show_removed,
    });

    return new NextResponse(markdown, {
      status: 200,
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    if (error instanceof NoDataError) {
      return NextResponse.json(
        { needs_scan: true, message: "No stored data for this scope. Run a scan to populate it." },
        { status: 409 }
      );
    }
    console.error("report", error);
    return NextResponse.json({ error: "Could not build the report." }, { status: 500 });
  }
}
