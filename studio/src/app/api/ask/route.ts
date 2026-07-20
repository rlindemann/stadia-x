import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { embedQuery, figureSearch, getCategoryApplicability, getClausesByIds, graphExpand, hybridSearch, rerankHits, type SearchFilters, type SearchHit } from "@/lib/db";
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

// Self-verification: a second pass fact-checks the answer against its cited clauses.
const VERIFY_MODEL = "claude-sonnet-5"; // focused fact-check; faster than the answer model
const VERIFY_SYSTEM = `You are a strict compliance fact-checker. You are given a question, a
proposed answer containing [[clause_id]] citations, and the source clauses. Check that every
factual claim in the answer is directly supported by the clause(s) it cites.
- If all claims are supported, set grounded=true and return the answer unchanged.
- If any claim is NOT supported by the provided clauses, set grounded=false, rewrite the
  answer to remove or correct the unsupported claim(s) (keep only what the clauses support,
  preserving the [[id]] citations), and list each unsupported claim in "issues".
Do not add outside information. Return valid JSON.`;
const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    grounded: { type: "boolean" },
    answer: { type: "string" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["grounded", "answer", "issues"],
  additionalProperties: false,
} as const;

async function verify(client: Anthropic, question: string, answer: string, context: string) {
  const msg = await client.messages.create({
    model: VERIFY_MODEL,
    max_tokens: 2048,
    system: VERIFY_SYSTEM,
    messages: [{ role: "user", content: `Question: ${question}\n\nProposed answer:\n${answer}\n\nSource clauses:\n\n${context}` }],
    output_config: { format: { type: "json_schema", schema: VERIFY_SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);
  const t = msg.content.find((b) => b.type === "text");
  return t ? (JSON.parse(t.text) as { grounded: boolean; answer: string; issues: string[] }) : null;
}

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
    // Pull a wider pool, then cross-encoder rerank down to the TOP_K seeds so the
    // answer is grounded in the most relevant clauses, not just the fusion order.
    const pool = await hybridSearch(lexQuery, embedding, 24, filters);
    const hits = (await rerankHits(question, pool)).slice(0, TOP_K);

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

    // Category-applicability: if the question names a Stadium Category, inject the
    // structured per-category requirements (the compliance-matrix rows) so the answer
    // is precise on "what must a Category X stadium do?" and cites the clause.
    const catMatch = question.match(/\b(?:cat(?:egory)?|class)\s*([a-e])\b/i);
    const category = catMatch ? catMatch[1].toUpperCase() : null;
    const applicability = category ? await getCategoryApplicability(category) : [];
    const applIds = [...new Set(applicability.map((a) => a.clause_id).filter((id): id is number => id != null))]
      .filter((id) => !seen.has(id));
    const applClauses = applIds.length ? await getClausesByIds(applIds) : [];
    applClauses.forEach((c) => seen.add(c.id));
    const applicabilityBlock = applicability.length
      ? `\n\nStructured requirements that apply to Stadium Category ${category} (from the compliance matrices; authoritative for category-specific requirements — use these and cite the clause id shown):\n\n` +
        applicability
          .map((a) => `[[${a.clause_id}]] ${a.standard_title} — ${a.req_ref ?? ""} ${a.requirement}: Category ${category} = ${a.value} (${a.modality})`)
          .join("\n")
      : "";

    // Figures/tables whose transcription matches the question — makes diagram/
    // matrix content answerable. Attach to their owning clause id.
    const figures = (await figureSearch(embedding, 3)).filter((f) => f.sim >= 0.35);
    const figureBlock = figures.length
      ? `\n\nTranscribed tables/figures relevant to the question; treat their content as clause data and cite the clause id shown:\n\n` +
        figures
          .map((f) => `[[${f.clause_id}]] (${f.kind}, ${f.standard_title} ${f.clause_path ?? ""}, p.${f.page}):\n${f.transcription}`)
          .join("\n\n")
      : "";

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

    const context = `${contextBlock(hits)}${relatedBlock}${applicabilityBlock}${figureBlock}`;
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Question: ${question}\n\nContext clauses:\n\n${context}` }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);

    const text = msg.content.find((b) => b.type === "text");
    const parsed = text ? JSON.parse(text.text) : { sufficient: false, answer: "" };

    // Self-verification: fact-check every claim against the cited clauses; correct or
    // flag anything unsupported. Falls back to the original answer if the pass errors.
    let answer: string = parsed.answer;
    let verified = true;
    let issues: string[] = [];
    if (parsed.sufficient && answer) {
      try {
        const v = await verify(client, question, answer, context);
        if (v) { answer = v.answer || answer; verified = v.grounded; issues = v.issues ?? []; }
      } catch (e) {
        console.error("verify failed, using unverified answer:", e);
      }
    }

    // Return seeds + graph-expanded clauses so the client can resolve every [[id]].
    return NextResponse.json({
      sufficient: parsed.sufficient,
      answer,
      verified,
      issues,
      clauses: [...hits, ...expanded, ...applClauses],
      expanded: expanded.map((e) => ({ id: e.id, edge_type: e.matched_question })),
      figures: figures.map((f) => ({
        id: f.id,
        clause_id: f.clause_id,
        kind: f.kind,
        image_url: f.image_url,
        page: f.page,
        clause_path: f.clause_path,
        standard_title: f.standard_title,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
