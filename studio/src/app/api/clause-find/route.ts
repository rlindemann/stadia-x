import { NextRequest, NextResponse } from "next/server";
import { findClauses } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Header jump-box lookup: /api/clause-find?q=1.4
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ results: [] });
  try {
    const results = await findClauses(q);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
