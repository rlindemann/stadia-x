import { NextRequest, NextResponse } from "next/server";
import { deleteStandard, setReviewStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Approve/unpublish/delete a standard from the review queue.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action as "publish" | "unpublish" | "delete";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    if (action === "delete") await deleteStandard(id);
    else await setReviewStatus(id, action === "publish" ? "published" : "pending");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
