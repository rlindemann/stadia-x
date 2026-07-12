import { NextRequest, NextResponse } from "next/server";
import { standardSourceUrl } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same-origin PDF proxy: streams the source PDF from R2 so the in-app viewer
// never makes a cross-origin request (no R2 CORS config needed).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = await standardSourceUrl(id);
  if (!url) return new NextResponse("No source PDF for this document", { status: 404 });

  const upstream = await fetch(url, { headers: { "User-Agent": "stadia-x" } });
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Failed to fetch source PDF", { status: 502 });
  }
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
