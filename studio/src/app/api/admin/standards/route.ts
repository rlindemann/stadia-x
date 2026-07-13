import { NextResponse } from "next/server";
import { listAdminStandards } from "@/lib/db";
import { ingestEnabled } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ standards: await listAdminStandards(), ingestEnabled: ingestEnabled() });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
