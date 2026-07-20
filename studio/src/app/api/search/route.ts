import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, embedQuery, figureSearch, hybridSearch, logAudit, rateLimited, rerankHits, type SearchFilters } from "@/lib/db";
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
  return { query, expansions, count: results.length, results, figures };
}

function csv(v: string | null): string[] | undefined {
  const list = v?.split(",").map((s) => s.trim()).filter(Boolean);
  return list && list.length ? list : undefined;
}

async function handle(req: NextRequest, query: string, limit: number, filters: SearchFilters) {
  const session = req.cookies.get("sx_session")?.value ?? null;
  if (session && (await rateLimited(session, "search", 40, 60))) {
    return NextResponse.json({ error: "Rate limit exceeded — please slow down." }, { status: 429 });
  }
  const cacheKey = `search:${query}:${limit}:${JSON.stringify(filters)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    await logAudit({ session_id: session, action: "search", target: query, status: "ok", latency_ms: 0, meta: { cached: true } });
    return NextResponse.json(cached);
  }
  const t0 = Date.now();
  try {
    const data = await run(query, limit, filters);
    await cacheSet(cacheKey, data, 600); // 10 min; cleared on publish/unpublish
    await logAudit({ session_id: session, action: "search", target: query, status: "ok",
      latency_ms: Date.now() - t0, meta: { results: data.count, figures: data.figures.length, filters } });
    return NextResponse.json(data);
  } catch (e) {
    await logAudit({ session_id: session, action: "search", target: query, status: "error",
      latency_ms: Date.now() - t0, meta: { error: String((e as Error).message ?? e) } });
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const query = p.get("q")?.trim();
  const limit = Number(p.get("limit")) || 20;
  if (!query) return NextResponse.json({ error: "q required" }, { status: 400 });
  return handle(req, query, limit, {
    obligation: csv(p.get("obligation")),
    status: csv(p.get("status")),
    publisher: csv(p.get("publisher")),
    standardId: csv(p.get("standard")),
    currentOnly: p.get("current") === "1",
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const limit = Number(body.limit) || 20;
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });
  return handle(req, query, limit, (body.filters as SearchFilters) ?? {});
}
