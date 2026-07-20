# Retrieval — the complete specification

**The single source of truth for how stadia-x finds and answers.** Every retrieval
mechanism, ranking lever, quality control, and gotcha in one place, grounded in the
live code. Copy this file alone into any repo doing clause/chunk-level RAG.

Stack: Postgres (Neon) with **pgvector** + **tsvector** · **Voyage** embeddings ·
**Claude** for answers · Next.js API. One database carries vectors, full-text, and the graph.

---

## 1. Architecture at a glance

A query flows through three retrieval signals, fused, filtered, re-ranked, and — for
Ask — expanded over the graph and handed to the LLM with strict grounding.

```
                    ┌── dense vector search (clause text)      ─┐
   user query ──►   ├── dense vector search (anticipated Qs)   ─┼─► RRF fusion ──► de-rank ──► results
     │              └── full-text search (tsvector + synonyms) ─┘        │
     │                                                                   ├─► figures/tables (vector)
     └─► (Ask only) retrieved seeds ──► GraphRAG hop ──► LLM ──► cited, grounded answer
```

Everything is **transparent**: each result carries which signals fired and its rank in each.

---

## 2. Embeddings & indexes

- **Model:** Voyage **`voyage-3.5`**, **1024 dimensions**. `input_type=document` at index time, `input_type=query` at search time (Voyage's asymmetric mode). Query embedding is a live API call from the serverless function — no local model.
- **Clause vectors:** `clauses.embedding vector(1024)`, index **HNSW cosine** (`vector_cosine_ops`). One embedding per clause — of **(context + verbatim_text)**, see §2a.
- **Anticipated-question vectors:** `clause_questions.embedding vector(1024)`, HNSW cosine. One row per question (see §3).
- **Full-text:** `clauses.tsv` — a **generated** `tsvector` column over **`context || verbatim_text`** (§2a), **GIN** indexed. Queried with `websearch_to_tsquery`, scored with `ts_rank`.

> Vector index is **HNSW**, not a "metric tree" (KD/ball/VP/cover tree). Metric trees collapse under the curse of dimensionality at 1024-dim — HNSW (a navigable small-world graph) is the correct modern choice.

## 2a. Contextual retrieval (Anthropic technique)

A clause embedded on its own is often ambiguous ("Minimum three (3)"). `ingest/contextualize.py` has an LLM (Haiku) write a one-sentence context situating each clause in its document/section, stores it in `clauses.context`, and:
- **Contextual embeddings** — the clause is embedded as `context + verbatim_text`, so the vector carries what section/topic it belongs to.
- **Contextual BM25** — the `tsv` full-text column is generated over `context || verbatim_text`, so keyword search benefits too.

Query stays raw (asymmetric: document side gets context, query side doesn't). Anthropic reports ~35-49% fewer failed retrievals from this.

---

## 3. The anticipated-questions index (the highest-payoff recall lever)

Also called Hypothetical Questions / reverse-HyDE / questions-answered indexing.

- **What:** during extraction the LLM writes **3-5 questions each clause answers**, stored **question-only** (the clause *is* the answer) in `clause_questions`, each embedded as its own row pointing back to the clause.
- **Why:** a user query *is a question*. Matching query→question lands far more reliably than query→legal-prose. Search ranks over clause text **and** its questions; either hit resolves to the clause.
- **Cost:** the marginal LLM cost rides on the extraction pass — cheapest, highest-payoff lever.
- **Surfaced in the UI:** the clause page shows a "Questions this clause answers" block (clickable → runs that search), so the index doubles as an exploration aid.
- **Where:** generated in `ingest/extract.py`; loaded to `clause_questions` by `ingest/load.py`; used in `hybridSearch` (the `qd` CTE) and Ask.

---

## 4. Hybrid ranking (three signals + RRF)

`hybridSearch` in `studio/src/lib/db.ts` runs three independent searches, each capped, then fuses by **Reciprocal Rank Fusion (RRF, k=60)**:

| Signal | Source | Cap | Rank field |
|---|---|---|---|
| **dense** | clause embedding ↔ query | top 50 | `dense_rnk` |
| **qd** (questions) | clause_questions embeddings ↔ query (min rank per clause) | top 80 | `qdense_rnk` |
| **lex** | `ts_rank(tsv, websearch_to_tsquery)` | top 50 | `lex_rnk` |

Fused score:
```
score = 1/(60+dense_rnk) + 1/(60+qdense_rnk) + 1/(60+lex_rnk)     -- missing signal contributes 0
```
RRF is robust because it needs no score normalization across incomparable scales (cosine vs ts_rank) — it fuses **ranks**, not scores. A clause hit by all three signals ranks highest; a strong hit in any one still surfaces.

This is the **first stage** — it produces a candidate pool of ~40 (Search) / ~24 (Ask), which the cross-encoder reranker (§4a) then reorders.

---

## 4a. Cross-encoder reranking (second stage)

The hybrid stage is a **bi-encoder**: query and clause are embedded *separately*, so nothing ever reads them together. `rerankHits` (`db.ts`) adds a second stage — a **cross-encoder** (Voyage `rerank-2.5`) that reads the query and each candidate **together** and scores the true match, then reorders the pool; Search keeps the top `limit`, Ask keeps the top 8 seeds. Too slow for the whole corpus, so it only runs on the ~40/~24 first-stage pool. Superseded clauses are nudged ×0.6 on the rerank score to keep the current-edition preference. **Falls back to the first-stage order** if the rerank API errors, so search never breaks. Measured lift on the eval set: hit@1 60%→70%, MRR 0.800→0.833.

---

## 5. Ranking levers (heuristics on the first-stage fused score)

Applied as multipliers to the fused score, in both the ORDER BY **and** the returned score (so the displayed relevance stays monotonic with rank):

- **Superseded editions × 0.6** — current-edition clauses win when both exist.
- **Glossary definitions × 0.7** — definitions are short and keyword-dense, so they out-rank the substantive requirement on a topic search; users want the requirement, not the one-line definition. (Definitions still surface for definitional queries via the questions index.)

> Levers are added **evidence-driven, from real misses** — never tune blind. The definition de-rank came from "control room" returning the glossary entry above the requirement.

---

## 6. Query understanding — synonym / acronym expansion

`studio/src/lib/synonyms.ts`. A small **hand-curated** group list (recall help, not a thesaurus). If the query mentions any surface form, the others are OR'd into the **full-text** query only — **never the semantic vector** (which would dilute meaning). Examples: `field of play = FoP = pitch`; `floodlight = lux = illuminance`; **`control room = venue operation centre`** (the 2026 edition renamed the concept — bridges editions, both directions). Confirm the exact corpus surface form before adding a group; skip acronyms not actually used.

---

## 7. Facets & hard filters

Server-side, first-class params on every search: `obligation_type`, `status`, `publisher`, `standard_id`, and **current-only** (`status is distinct from 'Superseded'`). Filters apply inside each signal's CTE, so they narrow recall before fusion, not after.

---

## 8. Result transparency (trust)

For a compliance tool, users must trust *why* a clause surfaced. Each result shows:
- **"Matched on" chips** derived from the per-signal ranks: **Meaning** (dense), **Wording** (lexical), **Answers a question** (questions index), **Table** (a figure matched).
- **Query-term highlighting** in the snippet and the matched question — you see *where* it hit.
- **One honest Relevance bar** (the fused, de-ranked score normalized to the RRF upper bound `3/61`).

---

## 9. Multimodal — tables & figures in retrieval

Compliance matrices (the ✓/△/✗ "required per category" tables) are **vector drawings**, invisible to text search. The pipeline (`ingest/figures.py`) detects, renders, **vision-transcribes**, and embeds them into `clause_figures`. `figureSearch` (vector search over transcriptions) runs alongside every query:
- **Search:** figures with `sim ≥ 0.4` show inline under their clause, and a table whose clause the text search *missed* appears in a top strip.
- **Ask:** figures with `sim ≥ 0.35` are injected into the LLM context as clause data (cited by clause id).

---

## 10. Ask — grounded, cited answering

`studio/src/app/api/ask/route.ts`. Retrieval feeds a strictly-grounded LLM answer:

1. Hybrid search, **TOP_K = 8** seeds.
2. **GraphRAG hop** (§11): pull graph neighbours of the seeds (default on).
3. **Figures** (`figureSearch`, sim ≥ 0.35) injected as clause data.
4. **Category applicability** (§13) — if the question names a Stadium Category, the structured `clause_applicability` rows for that category are injected as authoritative context (with their clauses merged in so citations resolve).
5. **Claude `claude-opus-4-8`**, adaptive thinking, JSON-schema output `{sufficient, answer}`. System prompt: ground every factual sentence in the provided clauses; cite with `[[clause_id]]` markers; flag superseded clauses; **if the clauses don't suffice, set `sufficient:false` and refuse — no invented rules.**
6. Response returns the answer, the resolvable clauses (seeds + expanded + applicability), and matched figures.

Honest abstention is a first-class behaviour, not an afterthought — verified by the eval harness (§12).

---

## 11. GraphRAG expansion (for Ask)

A typed clause graph in `clause_edges(src, dst, edge_type, weight)`, rebuilt by `ingest/build_graph.py`. Edge types: **reference** (resolved "see clause X"), **supersedes** (same clause across editions), **defines_term** (clause → the clause defining a term it uses), **similar** (semantic k-NN). Traversal is **recursive CTEs** (`graphExpand`, `getClauseGraph`) — no triplestore. Ask hops **one step** from its retrieved seeds to pull in clauses they reference / define / supersede — the multi-hop context flat search misses.

---

## 12. Quality & trust — the three "questions" and the eval harness

Three artifacts get called "questions"; keep them separate:

| Artifact | Job | Home |
|---|---|---|
| **Anticipated questions** (3-5/clause, auto, question-only) | **retrieval recall** | `clause_questions` + clause page |
| **Approved Q-A pairs** (human-vetted Q + answer + source) | **trust / regression** — grade accuracy | `studio/eval/pairs.json` |
| **Competency questions** (what the system MUST answer) | **scope / coverage** — decide what to model | `studio/eval/competency-questions.md` |

One-liner: anticipated = signpost (findability); approved Q-A = exam question with answer key (scoreability); competency = the syllabus (what to model).

**Eval harness** (`studio/eval/run.mjs`, `npm run eval`): scores the **live** Search + Ask endpoints against the approved pairs. Metrics — retrieval **found@K / hit@1 / hit@5 / MRR**; Ask **cites-correct + facts-present + sufficient**; abstain pairs must return `sufficient:false`. **Non-zero exit on a hard failure** (expected clause missing from top-K, or a hallucinated answer that should have refused) so it gates CI. Run after every ranking/prompt change — turns "feels right" into a number. Baseline: found@10 100%, hit@5 100%, MRR 0.800, Ask 11/11.

---

## 13. Category applicability — APPLIES_TO (built)

The ✓/△/✗ "required per Stadium Category" matrices carry `APPLIES_TO(requirement → Category A-E)` with a modality (mandatory / best-practice / non-applicable) and a per-category value. Previously that lived only as free text in `clause_figures.transcription`, so "what must a Category B stadium comply with?" was unanswerable by query. **Now extracted as structure** (`ingest/applies_to.py` LLM-parses each matrix):

- **`clause_applicability`** table — one row per (requirement × category) cell: `req_ref`, `requirement`, `category`, `value` (raw, e.g. "4" / "Min. 6" / "mandatory"), `modality`, linked to the clause. 285 cells / 53 requirements across Categories A-E (2026 edition).
- **`/categories` page** (+ `/api/applicability`) — pick a standard + category → the mandatory and best-practice requirements with per-category values, each linking to its clause.
- **Wired into Ask** (§10) — a question naming a category ("Category B", "Cat E") injects the applicability rows as authoritative context, so Ask answers with the exact number and modality and cites the clause.

Only editions that publish per-category matrices get this (currently 2026). The general lesson stands: **matrix/table payloads carry the real APPLIES_TO structure — extract it as rows/edges, not prose.** A competency question ("everything that applies to X") is the signal you need it.

---

## 14. Gotchas / operational notes

- **Neon returns bigint columns as strings** — clause ids arrive as `"1028"`, and `[[id]]` citation markers are text. Compare ids **as strings** everywhere (bit the eval harness).
- **Extractor merges** a heading + its `.1` sub-clause under the parent path (the 24051 control-room clause is path `10`, not `10.1`) — verify the real path when curating eval pairs.
- **Anthropic SDK refuses non-streaming requests with large `max_tokens`** (>~16k) — extraction keeps `MAX_TOKENS=16000` and splits windows instead of raising it.
- **psycopg** needs literal `%` escaped as `%%` when params are used (the ingest side; the Neon serverless client uses `$1` placeholders and does not).
- Query-time embedding is a **Voyage API call** in the serverless function — do not reintroduce a local embedding model.

---

## 15. Code map

- `studio/src/lib/db.ts` — `hybridSearch` (3 signals + RRF + de-rank), `figureSearch`, `graphExpand` / `getClauseGraph`, `embedQuery`.
- `studio/src/lib/synonyms.ts` — lexical synonym expansion.
- `studio/src/app/api/search/route.ts` — search endpoint (+ figures).
- `studio/src/app/api/ask/route.ts` — grounded, cited answering (+ GraphRAG hop + figures).
- `studio/src/components/search-view.tsx` — why-it-matched chips, highlighting, figure cards.
- `ingest/extract.py` — clauses + the 3-5 anticipated questions.
- `ingest/build_graph.py` — `clause_edges`. `ingest/figures.py` — multimodal tables/figures.
- `ingest/applies_to.py` — parses compliance matrices into `clause_applicability` (§13).
- `studio/src/app/categories/` + `api/applicability/` — the by-category requirements view.
- `studio/eval/` — `pairs.json` (approved), `competency-questions.md`, `run.mjs` (scorer).
- `db/schema.sql` — `clauses`, `clause_questions`, `clause_edges`, `clause_figures`, `clause_applicability`, all indexes.

---

## 16. Roadmap to state-of-the-art (what is NOT here yet)

Honest scope. "Enterprise grade" is four pillars: **Quality** (best-in-class retrieval), **Trust** (grounded, verified, measurably accurate), **Governance** (access control, audit, compliance), **Ops** (observability, caching, feedback, SLAs). Sections 1-13 are a strong core of Quality + Trust. The items below are **not built** — the advanced-quality, eval-at-scale, governance, and ops layers. Each: plain-English *what it is*, then status (✅ have · ◑ partial · ○ missing).

### 16.1 Retrieval quality
- **Cross-encoder reranking** ✅ **built** (see §4a) — a second stage that reads the query and each candidate together (Voyage `rerank-2.5`) and reorders the first-stage pool. Lifted hit@1 60%→70%, MRR 0.800→0.833 on the eval set.
- **Contextual Retrieval** (Anthropic) ✅ **built** (see §2a) — LLM-written context per clause, folded into both the embedding and the tsvector.
- **Parent-document / small-to-big** ○ — Match on small precise chunks but return the larger surrounding section for context. Precision of small + richness of big.
- **Field boosting** ○ — Weight a hit in the clause number/heading higher than a hit buried in body text.
- **MMR (Maximal Marginal Relevance)** ○ — Stop returning five near-identical results; pick ones that are relevant **and** diverse.
- **Multi-vector / late interaction (ColBERT)** ○ — One vector per *word* instead of per chunk, for finer matching. Powerful but heavier. (Advanced.)
- **True BM25** ◑ — We use Postgres `ts_rank`; ParadeDB/`pg_search` gives real in-database BM25 (better keyword scoring).

### 16.2 Query understanding
- **Query rewriting / multi-query** ○ — An LLM rewrites your question into a cleaner search query, or generates several variants, searches all, and merges — catches cases where your words don't match the document's words.
- **HyDE (Hypothetical Document Embeddings)** ○ — Instead of searching with the question, the LLM first drafts a fake ideal answer and searches with **that** (a hypothetical answer resembles the real document more than the question does). We do the *reverse* (index questions per clause, §3) — related but not the same.
- **Query decomposition** ○ — Split a complex multi-part question into sub-questions, retrieve for each, combine.
- **Spelling / typo tolerance** ○ — Handle misspelled queries.
- **Conversational rewrite** ○ — In a chat, turn "what about for Category C?" into a full standalone question using the previous turn. (Ask is single-turn today.)

### 16.3 Answer generation
- **Self-verification pass** ○ — After the answer, a second LLM pass checks each sentence against the cited sources and removes/flags anything unsupported. Matters most for compliance.
- **Citation faithfulness check** ◑ — We instruct citation in the prompt but never *verify* every claim is actually supported; this makes it programmatic.
- **Streaming** ○ — Show the answer as it types instead of waiting for the whole thing.

### 16.4 Evaluation & trust
- **Eval at scale** ✅ **built** — `ingest/gen_eval.py` generates ~70 realistic differently-worded questions from real clauses (ground truth = clause id), scored by `run.mjs` as a separate set. It exposed the true baseline the 10-pair set hid: **found@10 74%, hit@1 34%, MRR 0.479** (vs the easy approved set's 100%/70%). Synthetic, so ~a pessimistic floor, but a stable comparable number. Still to add: RAGAS / LLM-as-judge for automated faithfulness/relevance scoring.
- **RAGAS / automated RAG metrics** ○ — A framework that auto-scores faithfulness, context-precision, and answer-relevance with an LLM — no manual labeling.
- **LLM-as-judge** ○ — Use a strong model to grade answer quality automatically at scale.
- **Feedback loop** ○ — Thumbs up/down on answers → use that signal to improve ranking over time.

### 16.5 Governance & ops (the layer that actually makes it "enterprise")
- **Access control (permission-filtered retrieval)** ○ — Only return documents the current user is allowed to see, filtered at query time. Non-negotiable for a real enterprise deployment.
- **Audit logging** ○ — Record who searched/asked what, when, and what they saw.
- **PII redaction · multi-tenancy · rate limiting** ○ — Data-isolation and abuse-prevention basics.
- **Observability / tracing** ○ — Log every query → retrieval → answer with latency and cost, to debug and monitor.
- **Caching · monitoring / alerting** ○ — Query/embedding caches; alerts when quality or latency regress.
- **Incremental / real-time indexing** ◑ — Today a standard reloads in a batch; enterprise wants live updates on change.

### 16.6 Priority order (highest impact first)
- ✅ **Cross-encoder reranking** — done (§4a).
- ✅ **Contextual Retrieval** — done (§2a).
- ✅ **Eval at scale** — done (16.4); baseline found@10 74%, hit@1 34%, MRR 0.479. This is now the number every change below must move.
1. **Query rewriting / multi-query + HyDE** (16.2) — catches paraphrase/vocabulary misses (the 26% not found@10).
2. **Answer self-verification** (16.3) — closes the last hallucination risk (compliance-critical).
3. **RAGAS / LLM-as-judge** (16.4) — automated faithfulness/relevance scoring on top of the pair-based eval.
4. **Governance: access control + audit + observability** (16.5) — the enterprise non-negotiables.
