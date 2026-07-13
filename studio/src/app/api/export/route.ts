import { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = {
  clause: {
    id: number;
    clause_path: string;
    heading_trail: string;
    standard_title: string;
    publisher: string | null;
    standard_status: string | null;
    obligation_type: string;
    page: number;
    verbatim_text: string;
  };
  note: string;
};

// Wrap a string to a max width in the given font/size (pdf-lib has no auto-wrap).
function wrap(text: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function buildPdf(name: string, items: Item[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 56; // margin
  const W = 595.28; // A4 width
  const H = 841.89; // A4 height
  const maxW = W - M * 2;
  const green = rgb(0.18, 0.42, 0.3);
  const grey = rgb(0.4, 0.4, 0.38);
  const ink = rgb(0.08, 0.08, 0.07);

  let page = doc.addPage([W, H]);
  let y = H - M;

  const ensure = (need: number) => {
    if (y - need < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const line = (text: string, f: import("pdf-lib").PDFFont, size: number, color = ink, gap = 4) => {
    for (const ln of wrap(text, f, size, maxW)) {
      ensure(size + gap);
      page.drawText(ln, { x: M, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };

  line(name, bold, 20, ink, 8);
  line("Compliance report — Stadia-X", font, 10, grey, 16);

  items.forEach((it, i) => {
    const c = it.clause;
    y -= 8;
    ensure(60);
    const status = c.standard_status === "Superseded" ? " [SUPERSEDED]" : "";
    line(`${i + 1}. ${c.publisher ? c.publisher + " · " : ""}${c.standard_title}${status}`, font, 9, grey, 3);
    line(`${c.clause_path}  ·  ${c.obligation_type}  ·  p.${c.page}`, bold, 11, green, 5);
    line(c.verbatim_text, font, 10.5, ink, 4);
    if (it.note) line(`Note: ${it.note}`, font, 9.5, grey, 4);
    y -= 6;
  });

  return doc.save();
}

async function buildDocx(name: string, items: Item[]): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: name, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: "Compliance report — Stadia-X", italics: true, color: "666660" })] }),
    new Paragraph({ text: "" }),
  ];

  items.forEach((it, i) => {
    const c = it.clause;
    const status = c.standard_status === "Superseded" ? " [SUPERSEDED]" : "";
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${i + 1}. ${c.publisher ? c.publisher + " · " : ""}${c.standard_title}${status}`, color: "666660", size: 18 }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `${c.clause_path}`, bold: true, color: "2E6B4D" }),
          new TextRun({ text: `  ·  ${c.obligation_type}  ·  p.${c.page}`, color: "666660" }),
        ],
      }),
      new Paragraph({ children: [new TextRun({ text: c.verbatim_text })] }),
    );
    if (it.note) children.push(new Paragraph({ children: [new TextRun({ text: `Note: ${it.note}`, italics: true, color: "666660" })] }));
    children.push(new Paragraph({ text: "" }));
  });

  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export async function POST(req: NextRequest) {
  const fmt = req.nextUrl.searchParams.get("fmt") === "docx" ? "docx" : "pdf";
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Collection";
  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return new Response("no items", { status: 400 });

  try {
    const safe = name.replace(/[^\w.-]+/g, "_");
    if (fmt === "docx") {
      const buf = await buildDocx(name, items);
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${safe}.docx"`,
        },
      });
    }
    const pdf = await buildPdf(name, items);
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safe}.pdf"`,
      },
    });
  } catch (e) {
    return new Response(String((e as Error).message ?? e), { status: 500 });
  }
}
