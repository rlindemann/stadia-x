import { NextRequest, NextResponse } from "next/server";
import { createPendingStandard } from "@/lib/db";
import { runPipeline, savePdf, ingestEnabled } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Upload a PDF and register it as a standard pending review. If self-hosted
// ingestion is enabled, extraction + load run now; otherwise the row is created
// and extraction must be run from the CLI on a host with the Python pipeline.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const id = String(form.get("id") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const publisher = String(form.get("publisher") ?? "").trim() || null;
    const supersedes = String(form.get("supersedes") ?? "").trim() || null;
    const ocr = form.get("ocr") === "on";

    if (!(file instanceof File)) return NextResponse.json({ error: "PDF file required" }, { status: 400 });
    if (!id || !title) return NextResponse.json({ error: "id and title required" }, { status: 400 });
    if (file.type && file.type !== "application/pdf") return NextResponse.json({ error: "file must be a PDF" }, { status: 400 });

    await createPendingStandard(id, title, publisher, supersedes);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfPath = await savePdf(id, bytes);

    if (!ingestEnabled()) {
      return NextResponse.json({
        ok: true,
        pending: true,
        message:
          `Registered "${id}" as pending. Automatic extraction is disabled on this server ` +
          `(set LOCAL_INGEST=1 on a host with the Python pipeline). Run it manually:\n` +
          `uv run python -m ingest.extract data/uploads/${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf ${id} --title "${title}"`,
      });
    }

    const result = await runPipeline({ id, title, publisher, supersedes, pdfPath, ocr });
    return NextResponse.json({ ok: result.ok, log: result.log });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
