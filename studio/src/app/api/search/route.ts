import { NextRequest, NextResponse } from "next/server";
import { embedQuery, figureSearch, hybridSearch, rerankHits, type SearchFilters } from "@/lib/db";
import { expandLexicalQuery } from "@/lib/synonyms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIG_MIN = 0.4; // only surface tables/figures that clearly relate to the query
const CANDIDATES = 40; // first-stage pool handed to the cross-encoder reranker

async function run(query: string, limit: number, filters: SearchFilters) {
  // Embed the natural-language query; expand only the lexical side with synonyms
  // so acronym/synonym recall improves without diluting the semantic vector.
  const { lexQuery, expansions } = expandLexicalQuery(query);
  const embedding = await embedQuery(query);
  const [fused, figuresRaw] = await Promise.all([
    hybridSearch(lexQuery, embedding, CANDIDATES, filters),
    figureSearch(embedding, 6),
  ]);
  // Second stage: cross-encoder rerank the pool, then keep the top `limit`.
  const results = (await rerankHits(query, fused)).slice(0, Math.min(limit, 50));
  // Surface matching tables/figures alongside clause text, honouring the standard filter.
  let figures = figuresRaw.filter((f) => f.sim >= FIG_MIN);
  if (filters.standardId?.length) figures = figures.filter((f) => filters.standardId!.includes(f.standard_id));
  return NextResponse.json({ query, expansions, count: results.length, results, figures });
}

function csv(v: string | null): string[] | undefined {
  const list = v?.split(",").map((s) => s.trim()).filter(Boolean);
  return list && list.length ? list : undefined;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const query = p.get("q")?.trim();
  const limit = Number(p.get("limit")) || 20;
  if (!query) return NextResponse.json({ error: "q required" }, { status: 400 });
  const filters: SearchFilters = {
    obligation: csv(p.get("obligation")),
    status: csv(p.get("status")),
    publisher: csv(p.get("publisher")),
    standardId: csv(p.get("standard")),
    currentOnly: p.get("current") === "1",
  };
  try {
    return await run(query, limit, filters);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const limit = Number(body.limit) || 20;
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });
  try {
    return await run(query, limit, (body.filters as SearchFilters) ?? {});
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
