import { NextResponse } from "next/server";
import { z } from "zod";
import { DEMO_DB_PATH } from "@/lib/store/sqlite";
import { openDemoDb } from "@/lib/store/sqlite/db";
import { buildDemoReport, NoDemoDataError } from "@/lib/store/sqlite/report";

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
 * POST /api/demo/github/report - the narrative report, built from the demo
 * SQLite dataset. No auth check; see metrics/route.ts for why that is safe
 * here specifically (a read-only rebuild of already-public demo data, not a
 * write).
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid report request." }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const markdown = buildDemoReport(openDemoDb(DEMO_DB_PATH), {
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
    if (error instanceof NoDemoDataError) {
      return NextResponse.json(
        { needs_scan: true, message: "No demo data for this scope." },
        { status: 409 }
      );
    }
    console.error("demo report", error);
    return NextResponse.json({ error: "Could not build the demo report." }, { status: 500 });
  }
}
