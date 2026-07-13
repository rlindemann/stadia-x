import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { embedQuery, hybridSearch, type SearchFilters, type SearchHit } from "@/lib/db";
import { expandLexicalQuery } from "@/lib/synonyms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-opus-4-8";
const TOP_K = 8;

const SYSTEM = `You are a compliance assistant for stadium and sports-facility standards.
Answer the user's question using ONLY the clauses provided in the context. Rules:
- Ground every factual sentence in the clauses. After each such sentence, cite the
  clause(s) it rests on with markers of the form [[<clause_id>]] using the numeric ids given.
- Never state a requirement that is not present in the clauses. Do not use outside knowledge.
- If a cited clause comes from a standard marked (SUPERSEDED), say so in the sentence and
  prefer current-edition clauses where both exist.
- If the clauses do not contain enough to answer, set sufficient to false and give a short
  answer saying there is no sufficient basis in the corpus (no invented rules).
Keep the answer concise and specific. Return valid JSON matching the schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    sufficient: { type: "boolean" },
    answer: { type: "string" },
  },
  required: ["sufficient", "answer"],
  additionalProperties: false,
} as const;

function contextBlock(hits: SearchHit[]): string {
  return hits
    .map((h) => {
      const status = h.standard_status === "Superseded" ? " (SUPERSEDED)" : "";
      return `[[${h.id}]] ${h.publisher ?? ""} ${h.standard_title}${status} — ${h.clause_path} (${h.obligation_type}, p.${h.page})
${h.verbatim_text}`;
    })
    .join("\n\n");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });
  const filters: SearchFilters = (body.filters as SearchFilters) ?? {};

  try {
    const { lexQuery } = expandLexicalQuery(question);
    const embedding = await embedQuery(question);
    const hits = await hybridSearch(lexQuery, embedding, TOP_K, filters);

    if (hits.length === 0) {
      return NextResponse.json({
        sufficient: false,
        answer: "No sufficient basis in the corpus to answer this question.",
        clauses: [],
      });
    }

    const client = new Anthropic();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Question: ${question}\n\nContext clauses:\n\n${contextBlock(hits)}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);

    const text = msg.content.find((b) => b.type === "text");
    const parsed = text ? JSON.parse(text.text) : { sufficient: false, answer: "" };

    // Return the retrieved clauses so the client can resolve [[id]] citation markers.
    return NextResponse.json({
      sufficient: parsed.sufficient,
      answer: parsed.answer,
      clauses: hits,
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
