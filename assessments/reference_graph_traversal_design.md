# Design Note: Reference-Graph Traversal on the Current Schema

Companion to `hybrid_graph_rag_architecture.md`. That doc argues for "Hybrid Graph
RAG" with multi-hop traversal. This note sketches how to get the 80% of that value
on the **existing Neon Postgres schema** — no Neo4j, no Apache AGE (Neon doesn't
support it), no new infra — using **recursive CTEs** over the edges we already
model, plus the one prerequisite that actually gates the whole thing.

---

## 0. Reality check (measured 2026-07-13)

The traversable graph does **not exist yet**. The edges are declared in the schema
but almost none are resolved to real targets:

| Edge type | Table / column | Count | Traversable? |
|---|---|---|---|
| Clause → Clause reference | `refs.from_clause → refs.to_clause` | **0 / 180 resolved** | ❌ `to_clause` is NULL on every row |
| Clause → Standard reference | `refs.from_clause → refs.to_standard` | **0 / 180 resolved** | ❌ `to_standard` is NULL on every row |
| Raw reference string | `refs.raw` | 180 | text only, e.g. `"1.3"`, `"AFC Statutes"`, `"Competition Regulations"` |
| Standard → Standard supersession | `standards.supersedes` | 1 | ✅ (2026 → 2021) |
| Clause → Term definition | `terms.defined_in_clause` | 100 | ✅ one-directional (term's defining clause) |

**Conclusion:** the recursive-CTE traversal (Phase 1 below) is trivial SQL — a
few dozen lines. The real work, cost, and risk is **Phase 0: reference resolution**
— turning `refs.raw` strings into `to_clause` / `to_standard` foreign keys. Until
that runs, there are zero clause-to-clause edges to walk.

A second hard limit: many raw refs point at **external documents not in the corpus**
(`"AFC Statutes"`, `"Manual"`, `"Competition Regulations"`). Those can never resolve
to a `to_clause` — the target isn't ingested. Only *internal* refs (clause numbers
like `"1.3"`, `"30.2"`) within a loaded standard are resolvable. So expected yield
is bounded by the internal-vs-external split of the refs, not by resolver quality
alone.

---

## Phase 0 — Reference resolution (the gating work)

Goal: populate `refs.to_clause`, `refs.to_standard`, and `refs.reference_type` from
`refs.raw` + `refs.from_clause` context. Run once per load (extend `ingest/load.py`),
and as a backfill for already-loaded standards.

Classify each raw ref:

1. **Internal clause ref** — matches a clause-number pattern (`^\d+(\.\d+)*$`,
   `Article 12`, `clause 30.2`). Resolve to a clause in the *same* standard whose
   `clause_path` matches. → sets `to_clause`, `reference_type = 'internal'`.
2. **Cross-standard ref** — names another standard in the corpus (fuzzy title /
   publisher match). → sets `to_standard` (+ `to_clause` if it also carries a
   clause number). → `reference_type = 'cross-standard'`.
3. **External ref** — a document not in the corpus. Leave `to_clause`/`to_standard`
   NULL; set `reference_type = 'external'` so the UI can still render the raw string
   as a non-link. This is the honest "dangling edge."

Two implementation options:

- **Heuristic (cheap, deterministic):** regex for clause-number tokens + a lookup
  against `clauses.clause_path` within the from-clause's standard; a normalized
  title map for cross-standard. Fast, free, high precision on numbered refs, but
  misses prose refs.
- **LLM-assisted (higher recall):** for each raw ref, give Claude the from-clause
  context + the list of candidate `clause_path`s in the target standard and ask for
  the best match id or "external". Costs one cheap call per ref (batchable). Use the
  heuristic first, fall back to the LLM only for unresolved rows.

Measure and report resolution rate after each run (`% internal resolved`,
`% external`) — a silent resolver that leaves everything NULL looks identical to
"no graph."

> Until Phase 0 lands, Phases 1–2 return empty results. They are correct and ready;
> they just have no edges to walk.

---

## Phase 1 — Traversal via recursive CTE (works on Neon today)

Once `to_clause` is populated, multi-hop is a standard recursive CTE — no extension,
no new service.

### Forward walk: what a clause references, N hops out

```sql
with recursive walk as (
  select r.from_clause, r.to_clause, 1 as depth,
         array[r.from_clause, r.to_clause] as path
  from refs r
  where r.from_clause = $1 and r.to_clause is not null
  union all
  select r.from_clause, r.to_clause, w.depth + 1, w.path || r.to_clause
  from walk w
  join refs r on r.from_clause = w.to_clause
  where r.to_clause is not null
    and w.depth < $2                      -- depth cap (2-3 is plenty)
    and r.to_clause <> all(w.path)        -- cycle guard
)
select w.to_clause as clause_id, min(w.depth) as depth
from walk w
group by w.to_clause
order by depth;
```

Join the result to `clauses`/`standards` for display. **Reverse walk** (back-links:
"what references this clause?") is the same query with `from_clause`/`to_clause`
swapped — useful for impact analysis ("if we change 5.1, what depends on it?").

### Cross-edition bridging

Fold `standards.supersedes` in so a walk can hop from a superseded clause to its
current-edition counterpart (match on `clause_path` across the edition pair — the
same key the just-shipped edition-diff already uses).

### Performance

- Add `create index on refs (from_clause);` and `create index on refs (to_clause);`
  (the schema indexes neither today).
- Cap depth at 2–3 and cap fan-out; corpus-scale result sets stay tiny.
- If traversal ever gets hot, precompute a **closure table** (`clause_id, reachable_id,
  min_depth`) refreshed on load — still plain Postgres, no new infra.

---

## Phase 2 — Graph-expanded retrieval (the Graph-RAG payoff)

This is what turns the reference graph into better *answers*, wiring it into the
existing hybrid search + Ask:

```
1. Hybrid search (unchanged): query -> top-k seed clauses  S   [semantic+questions+lexical, RRF]
2. Graph expansion:  recursive walk from S along resolved refs, depth <= D  ->  neighbours N
3. Merge:  candidates = S ∪ N
           - S keep their retrieval rank
           - N tagged "referenced by <seed>" (provenance for the hop)
4. Feed S ∪ N to the Ask prompt; citations already carry clause ids
```

Why it helps: a question answered by clause A that *depends on* clause B ("subject to
the requirements of 5.1") currently only surfaces B if B independently matches the
query vector. Graph expansion pulls B in *because A points to it* — the multi-hop
case flat vector search misses (exactly the "aggregation / relational" gap in
`hybrid_graph_rag_architecture.md` §2).

Keep it bounded and honest: expand at most depth 1–2 from seeds, label expanded
clauses as related-not-matched, and never let expansion dilute the cited-answer
guardrail.

---

## App integration (incremental, additive)

| Layer | Change |
|---|---|
| `studio/src/lib/db.ts` | `getClauseGraph(id, depth)` (forward+reverse), returns resolved neighbours |
| API | `GET /api/clause/[id]/graph?depth=2` |
| Clause detail page | Extend the existing References section into an expandable **reference tree** (one hop is already shown there — this deepens it); render `external` refs as plain text, resolved refs as links |
| Ask | Optional "expand along references" toggle -> Phase 2 |

No schema migration needed for Phase 1/2 (columns already exist). Phase 0 only writes
to existing `refs` columns.

---

## Recommendation & phasing

1. **Phase 0 first, heuristic resolver** (S, ~1 day). Measure resolution rate; this
   tells you whether a graph layer is even worth it on this corpus, before building
   traversal. If most refs are external, stop here — the honest answer is "the
   reference graph is sparse for this data."
2. **Phase 1 traversal + reverse back-links** (S) once edges exist — reuse in the
   clause-detail reference tree.
3. **Phase 2 graph-expanded retrieval** (M) — the actual Graph-RAG upgrade; A/B it
   against plain hybrid search on a question set before defaulting it on.

Do **not** adopt Neo4j / Apache AGE / Microsoft GraphRAG for this. Recursive CTEs on
the Postgres you already run cover bounded multi-hop over a clause-reference graph;
reach for a real graph DB only if traversal depth/among-standards complexity outgrows
that — which this corpus is nowhere near.
