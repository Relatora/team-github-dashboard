import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guard";

/** Who is signed in, for client components that need it outside a server render. */
export async function GET() {
  return NextResponse.json({ user: await getSessionUser() });
}
