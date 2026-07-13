import { NextRequest, NextResponse } from "next/server";
import { embedQuery, hybridSearch } from "@/lib/db";
import { expandLexicalQuery } from "@/lib/synonyms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A topic is "covered" if its best clause clears this semantic-similarity bar.
const COVERED_AT = 0.5;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topics: string[] = Array.isArray(body.topics)
    ? body.topics.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 40)
    : [];
  const threshold = typeof body.threshold === "number" ? body.threshold : COVERED_AT;
  if (topics.length === 0) return NextResponse.json({ error: "topics required" }, { status: 400 });

  try {
    const results = await Promise.all(
      topics.map(async (topic) => {
        const { lexQuery } = expandLexicalQuery(topic);
        const embedding = await embedQuery(topic);
        const hits = await hybridSearch(lexQuery, embedding, 1, {});
        const top = hits[0];
        const score = top ? Math.max(top.dense_sim, top.q_sim ?? 0) : 0;
        return {
          topic,
          covered: score >= threshold,
          score,
          best: top
            ? {
                id: top.id,
                clause_path: top.clause_path,
                standard_title: top.standard_title,
                obligation_type: top.obligation_type,
                page: top.page,
                verbatim_text: top.verbatim_text,
              }
            : null,
        };
      }),
    );
    return NextResponse.json({ threshold, results });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
