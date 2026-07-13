import { NextRequest, NextResponse } from "next/server";
import { getEditionPair } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const pair = await getEditionPair(id);
    if (!pair) return NextResponse.json({ error: "no superseded edition for this standard" }, { status: 404 });
    return NextResponse.json(pair);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
