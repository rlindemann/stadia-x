import { NextRequest, NextResponse } from "next/server";
import { embedQuery, hybridSearch } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function run(query: string, limit: number) {
  const embedding = await embedQuery(query);
  const results = await hybridSearch(query, embedding, Math.min(limit, 50));
  return NextResponse.json({ query, count: results.length, results });
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim();
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 20;
  if (!query) return NextResponse.json({ error: "q required" }, { status: 400 });
  try {
    return await run(query, limit);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const limit = Number(body.limit) || 20;
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });
  try {
    return await run(query, limit);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
