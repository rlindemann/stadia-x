import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { embedQuery, graphExpand, hybridSearch, type SearchFilters, type SearchHit } from "@/lib/db";
import { expandLexicalQuery } from "@/lib/synonyms";

const EDGE_LABEL: Record<string, string> = {
  reference: "referenced by a retrieved clause",
  supersedes: "the same clause in another edition",
  defines_term: "defines a term a retrieved clause uses",
  similar: "closely related in meaning",
};

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
  const hop = body.hop !== false; // GraphRAG expansion on by default

  try {
    const { lexQuery } = expandLexicalQuery(question);
    const embedding = await embedQuery(question);
    const hits = await hybridSearch(lexQuery, embedding, TOP_K, filters);

    if (hits.length === 0) {
      return NextResponse.json({
        sufficient: false,
        answer: "No sufficient basis in the corpus to answer this question.",
        clauses: [],
        expanded: [],
      });
    }

    // GraphRAG: hop one step from the retrieved seeds to pull in clauses they
    // depend on / define / supersede — the multi-hop flat search misses.
    const seen = new Set(hits.map((h) => h.id));
    const expanded = hop
      ? (await graphExpand(hits.map((h) => h.id), 8)).filter((e) => !seen.has(e.id))
      : [];

    const relatedBlock = expanded.length
      ? `\n\nAdditional clauses reached via the knowledge graph (${expanded.length}); use them to complete or qualify the answer, and cite them the same way:\n\n` +
        expanded
          .map((h) => {
            const status = h.standard_status === "Superseded" ? " (SUPERSEDED)" : "";
            const why = EDGE_LABEL[h.matched_question ?? ""] ?? "related";
            return `[[${h.id}]] (${why}) ${h.standard_title}${status} — ${h.clause_path}: ${h.verbatim_text}`;
          })
          .join("\n\n")
      : "";

    const client = new Anthropic();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Question: ${question}\n\nContext clauses:\n\n${contextBlock(hits)}${relatedBlock}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);

    const text = msg.content.find((b) => b.type === "text");
    const parsed = text ? JSON.parse(text.text) : { sufficient: false, answer: "" };

    // Return seeds + graph-expanded clauses so the client can resolve every [[id]].
    return NextResponse.json({
      sufficient: parsed.sufficient,
      answer: parsed.answer,
      clauses: [...hits, ...expanded],
      expanded: expanded.map((e) => ({ id: e.id, edge_type: e.matched_question })),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
