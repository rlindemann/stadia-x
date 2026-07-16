import { NextRequest, NextResponse } from "next/server";
import { getClauseNeighbours } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Direct neighbours of a clause, for expanding the clause-page graph in place.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const neighbours = await getClauseNeighbours(Number(id));
    return NextResponse.json({ id: Number(id), neighbours });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
