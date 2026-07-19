import { NextRequest, NextResponse } from "next/server";
import { getCategoryRequirements } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/applicability?standard=AFC-STADIUM-REGULATIONS-2026&category=B
export async function GET(req: NextRequest) {
  const standard = req.nextUrl.searchParams.get("standard")?.trim();
  const category = req.nextUrl.searchParams.get("category")?.trim().toUpperCase();
  if (!standard || !category) return NextResponse.json({ error: "standard and category required" }, { status: 400 });
  try {
    const requirements = await getCategoryRequirements(standard, category);
    return NextResponse.json({ standard, category, requirements });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
