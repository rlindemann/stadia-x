import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { embedQuery, hybridSearch, listFacets, type SearchHit } from "@/lib/db";
import { expandLexicalQuery } from "@/lib/synonyms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-opus-4-8";
const PER_STANDARD = 4;

const SYSTEM = `You compare how different sports-facility standards treat a given topic.
You are given, per standard, its most relevant clauses. Rules:
- Ground every statement in the provided clauses; cite with [[<clause_id>]] markers.
- Do not invent requirements or use outside knowledge.
- For each standard, summarise its position on the topic in 1-3 sentences.
- In the overview, call out the concrete similarities and differences between the standards
  (thresholds, obligations, what one covers that another omits).
- If a standard has no relevant clause, say it does not appear to address the topic.
Return valid JSON matching the schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    positions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          standard_id: { type: "string" },
          summary: { type: "string" },
        },
        required: ["standard_id", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["overview", "positions"],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const wanted: string[] = Array.isArray(body.standards) ? body.standards : [];
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });

  try {
    const facets = await listFacets();
    const ids = (wanted.length ? wanted : facets.standards.map((s) => s.id)).slice(0, 6);
    const titleOf = new Map(facets.standards.map((s) => [s.id, s.title]));

    const { lexQuery } = expandLexicalQuery(topic);
    const embedding = await embedQuery(topic);

    // Top clauses per standard for the topic.
    const perStd = await Promise.all(
      ids.map(async (id) => ({
        id,
        title: titleOf.get(id) ?? id,
        hits: await hybridSearch(lexQuery, embedding, PER_STANDARD, { standardId: [id] }),
      })),
    );

    const context = perStd
      .map(
        (s) =>
          `### ${s.title} (${s.id})\n` +
          (s.hits.length
            ? s.hits.map((h) => `[[${h.id}]] ${h.clause_path} (${h.obligation_type}): ${h.verbatim_text}`).join("\n")
            : "(no relevant clauses)"),
      )
      .join("\n\n");

    const client = new Anthropic();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Topic: ${topic}\n\nStandards and their clauses:\n\n${context}` }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);

    const text = msg.content.find((b) => b.type === "text");
    const parsed = text ? JSON.parse(text.text) : { overview: "", positions: [] };

    const allClauses: SearchHit[] = perStd.flatMap((s) => s.hits);
    return NextResponse.json({
      topic,
      overview: parsed.overview,
      positions: parsed.positions,
      standards: perStd.map((s) => ({ id: s.id, title: s.title })),
      clauses: allClauses,
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
