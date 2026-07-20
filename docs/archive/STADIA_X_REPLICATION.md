# Stadia-X — Replication Blueprint

Extracted from the KYRA codebase. This document is a self-contained spec for
rebuilding KYRA's "ingest → extract → resolve → persist → query → explore"
knowledge-graph pipeline in another repository, adapted for a corpus of
**policy documents and standards** (Stadia-X) rather than podcasts.

It has three jobs:

1. **Describe the whole workflow** as it exists in KYRA, stage by stage, with
   the real file names, data contracts, and design decisions.
2. **Judge each part** — what is genuinely enterprise-grade and should be copied
   verbatim, and what works but should be redesigned for a document corpus.
3. **Give a concrete build order and schema** for Stadia-X, including the
   database recommendation.

> KYRA's domain is spoken podcasts (audio, transcripts, timestamps, speakers).
> Stadia-X's domain is written standards (PDF/DOCX/HTML, clauses, page numbers,
> normative references). The **architecture transfers wholesale**; the
> **ingest front-end and the extraction schema are the parts you rewrite**.

---

## 1. The architecture in one picture

Six stages, each a directory of scripts, connected by files on disk and two
datastores. Every stage is idempotent and independently runnable.

```
[1] INGEST            acquire raw source → normalized text + metadata on disk
      │                data/<type>/<source>/raw/<id>_{transcript.txt, metadata.json, shownotes.html}
      ▼
[2] EXTRACT           multipass LLM → one structured "knowledge object" per item
      │                data/<type>/<source>/extracted/<id>/knowledge_object.json
      ▼
[3] RESOLVE           dedupe entities across the corpus into a canonical registry
      │                fuzzy cluster → LLM canonicalize → human review → apply decisions
      │                data/entity_registry.json
      ├───────────────┬────────────────────────────────┐
      ▼               ▼                                 ▼
[4a] PERSIST GRAPH   [4b] PERSIST VECTORS         (both consume stage 2/3 output)
   Postgres             ChromaDB
   entities,            embedded chunks
   relationships,       (one per insight/clause/…)
   episodes, chunks
      │               │
      ▼               ▼
[5] QUERY             FastAPI service layer over both stores
      │                hybrid search + graph traversal + entity/theme queries
      ▼
[6] STUDIO            Next.js app: Search, Graph, Connect, Themes, Overview
```

**Two datastores, two jobs:**

- **Postgres 16 + pgvector** (Docker) is the **relational knowledge graph**:
  nodes (`entities`, `episodes`), edges (`relationships`), membership
  (`entity_episodes`), and text units (`chunks`). Traversed with SQL joins and
  an in-memory NetworkX graph.
- **ChromaDB** (on-disk, HNSW/cosine) is the **semantic search index**. Every
  extracted field becomes an embedded chunk with rich filterable metadata.

Both embed with `all-mpnet-base-v2` (768-dim). *(See §9 — this duplication is
one of the things to change for Stadia-X.)*

---

## 2. Stage 1 — Ingest

**KYRA location:** `src/kyra/ingest/{podcast,conference,article,book,signal}/`
plus a `transcribe/` step. `article/`, `book/`, `signal/` are empty stubs today.

**What it does:** every ingest path, however different upstream, converges on
one **raw-file contract** that the extractor consumes:

```
data/<type>/<source>/raw/<id>_transcript.txt    # required, > 500 chars
data/<type>/<source>/raw/<id>_metadata.json     # required
data/<type>/<source>/raw/<id>_shownotes.html    # optional supplementary context
```

KYRA has two ingest patterns behind that contract:

- **Text scrape** — `BaseScraper` (`ingest/base_scraper.py`) gives a `requests`
  session with retry/backoff and rate-limiting; subclasses parse HTML with
  BeautifulSoup/lxml (`troxl_scraper.py`, `lex_*`) or pull YouTube captions with
  `yt-dlp` (`youtube/yt_scraper.py`, one scraper driving 8 sources via a
  `SOURCES` registry).
- **Audio pipeline** — for sources with no transcript: download audio → `ffmpeg`
  to 16 kHz mono → `faster-whisper` ASR (CUDA, `float16` with `int8` fallback) →
  `pyannote` speaker diarization → align speakers to segments. This is
  `lex_whisper_transcribe_split.py` + `lex_diarize_align.py`.

### For Stadia-X

**Delete the entire audio pipeline** — Whisper, pyannote, yt-dlp, ffmpeg,
diarization are irrelevant to written standards. That removes the heaviest and
most fragile dependencies (CUDA, `huggingface-hub<1.0` pin, vendored
`simple-diarizer`).

**Replace with a document-ingest front-end** that produces the same raw-file
contract. One `DocumentLoader` base class, source subclasses per publisher/feed:

- **Parse** PDF / DOCX / HTML into text while **preserving structure** — this is
  the single most important change. For standards you must retain the
  section/clause hierarchy, clause numbers, page numbers, and heading trail.
  Use a layout-aware parser (e.g. `unstructured`, `pymupdf`/`PyMuPDF`,
  `docling`, or Azure Document Intelligence for scanned/complex PDFs) rather
  than a flat text dump.
- **Normalize** to a per-document JSON that carries the structure: an ordered
  list of blocks, each with `clause_path` (e.g. `"5.2.1"`), `heading_trail`,
  `page`, `text`, and `block_type` (heading / requirement / note / definition /
  table). This replaces KYRA's flat `_transcript.txt`.
- **Metadata** replaces podcast metadata: `standard_id` (e.g. `ISO 19650-1:2018`),
  `title`, `publisher` (the SDO), `version`, `status`
  (draft/active/superseded/withdrawn), `jurisdiction`, `effective_date`,
  `supersedes`, `source_url`.

KYRA's `BaseScraper` retry/rate-limit/save scaffolding is worth keeping as the
`DocumentLoader` base. Everything else in ingest is a rewrite.

---

## 3. Stage 2 — Extract (the multipass LLM core)

**KYRA location:** `src/kyra/extract/extract_knowledge.py` (1193 lines),
`taxonomy.py`, `validate_corpus.py`.

This is the **crown jewel** of the codebase and the part to copy most faithfully.
It is a production-grade batch LLM harness. The domain schema changes for
Stadia-X; the machinery does not.

### 3.1 The three passes (sequential, each feeds the next)

| Pass | Input | Output |
|---|---|---|
| **1 — Entities** | transcript + metadata + shownotes | `guest`, `people_mentioned`, `organizations_mentioned`, `products_mentioned`, `concepts_mentioned` |
| **2 — Relationships** | transcript + **pass-1 entity list** + rendered relation taxonomy | `relationships[{subject, relation, object, stance, year, timestamp, context}]` — subject/object must exactly match pass-1 names |
| **3 — Analysis** | transcript + **pass-1 entities + pass-2 graph** + rendered critique lenses | `essence`, `topics`, `insights`, `mental_models`, `predictions`, `takeaways`, `critical_analysis`, `confidence`, `quotes`, `time_horizon`, `audience`, `domains` |

The final `knowledge_object.json` is `{**entities, "relationships": rels,
**analysis}` with an `_audit` block prepended.

### 3.2 The prompt pattern (all passes identical shape)

Instruction line → `"Return a single valid JSON object; no markdown, no
preamble."` → context sections → `f"Return this exact structure:\n{json.dumps(SCHEMA,
indent=2)}"` → explicit rules → `"Return ONLY the JSON object"`. The JSON schema
template is embedded **verbatim in the prompt** as example-shaped instruction
text (not a tool-call / JSON-schema function).

### 3.3 Model calls

`MODELS` registry maps names → `{id, type, input_price, output_price}`:
`sonnet` (`claude-sonnet-4-6`), `opus` (`claude-opus-4-6`), `gemini_flash`.
- **Anthropic:** `client.messages.stream(model, max_tokens=32000, messages=[…])`,
  read `get_final_text()` + `get_final_message().usage`. No system prompt, no
  tools, relies on prompt discipline + fence stripping before `json.loads`.
- **Gemini:** `generate_content(..., config=GenerateContentConfig(
  response_mime_type="application/json", temperature=0))`.

### 3.4 Production infrastructure (copy all of this verbatim)

- **Checkpointing** (`CheckpointStore`) — per-pass files (`pass1_entities.json`,
  …) written atomically (`.tmp`→replace); `--resume` skips completed passes,
  `is_complete()` skips finished items. Survives crashes mid-corpus.
- **Retry/backoff** (`with_retry`) — 3 attempts, exponential backoff; retryable
  set = rate-limit / 5xx / timeout / connection / JSON-decode errors.
- **Budget tracking** (`BudgetTracker`) — thread-safe hard USD cap; raises before
  overspending. `_compute_cost` from token usage × per-model price.
- **Parallelism** — `ThreadPoolExecutor(max_workers)` + a global
  `threading.Semaphore` capping concurrent API calls; a `budget_hit` Event
  aborts the remaining batch.
- **Preflight** — drops items missing files or with < 500-char transcript before
  spending a cent.
- **Dry-run** — estimates cost from `chars//4` token heuristic × calibrated
  per-pass constants.
- **Dead-letter queue** — failures written to `.failures/<run_id>.json`;
  `--retry-failed` reloads the latest.
- **Schema-hash versioning** (`compute_schema_hash`) — SHA-256 (12 hex) over the
  schema/taxonomy YAML files, stored in every `_audit`, so you can tell which
  contract version produced any object and selectively re-extract.
- **JSONL logging** — machine-readable run log at `data/logs/<run_id>.jsonl`.

### 3.5 For Stadia-X — rewrite the schema, keep the harness

The podcast schema (`guest`, `insights`, `mental_models`, `predictions`,
`quotes`, `time_horizon`, `audience`) does not fit standards. Replace the three
`*_SCHEMA` dicts with a **document/clause schema**. Suggested passes:

- **Pass 1 — Document + entities:** `document{standard_id, title, publisher,
  version, status, jurisdiction, effective_date, supersedes}`,
  `standards_referenced[]`, `organizations[]` (SDOs, regulators),
  `defined_terms[{term, definition, clause_path}]`.
- **Pass 2 — Requirements + cross-references:** for each normative clause a
  `requirement{clause_path, obligation_type (shall|should|may|must),
  normative|informative, text, applies_to (scope), conditions[]}`; and
  `references[{from_clause, to_standard, to_clause, reference_type}]`.
- **Pass 3 — Analysis (optional):** clause summaries, compliance implications,
  ambiguities/gaps, conflicts with other standards. Reuse the **critique-lens**
  mechanism to drive "where could this requirement be misapplied / conflict."

**Critical for your stated goal ("query precisely certain paragraphs and
standards"):** every extracted item must carry a **structural anchor** — KYRA's
`source_anchor.timestamp` becomes `{standard_id, clause_path, page, block_id}`.
That anchor is what lets a query resolve to an exact paragraph. KYRA already has
`source_anchor` scaffolding in the schema; make it mandatory and structural.

Keep `taxonomy.py`'s pattern of **rendering a YAML taxonomy into the prompt** —
it is how you inject the relation vocabulary (§4) and lens set without hardcoding.

---

## 4. The data contracts (`shared/`)

**KYRA location:** `shared/schemas/`, `shared/taxonomy/`, `shared/frameworks/`.

- `schemas/knowledge_object.yaml` (schema_version 3) — the human-facing canonical
  contract: `enums`, an `output_template`, and 20+ `extraction_rules`. **Caveat:**
  the Python `*_SCHEMA` dicts in `extract_knowledge.py` are hand-duplicated from
  this YAML; the YAML is only byte-hashed at runtime, not parsed. Keep the two in
  sync (or generate one from the other — see §9).
- `schemas/relation_taxonomy.yaml` (taxonomy_version 2) — ~45 directed relation
  ids grouped by node-type pair (`person_to_person`, `concept_to_concept`,
  `any_to_any`, …), plus 4 `stance_values` (asserted/hedged/speculative/
  retracted). Rendered into Pass 2.
- `frameworks/critique_lens_taxonomy.yaml` — 11 critique lenses, rendered into
  Pass 3.
- `taxonomy/{domains,themes,categories,topics}.yaml` — controlled vocabularies.
  **Note:** these are *not* wired into extraction today (the `domains` field is
  free-text LLM output). They are downstream/reference artifacts.
- `query_synonyms.yaml` — synonym/acronym groups for query expansion (§6).

### For Stadia-X — the relation taxonomy is where the value is

KYRA's relations (`INTERVIEWED`, `MENTORED_BY`, `FOUNDED`…) are podcast-social.
For a standards graph, define relations that make the cross-reference network
precise and queryable:

```yaml
document_to_document:
  - SUPERSEDES        # this standard replaces another
  - AMENDS            # this standard modifies part of another
  - REFERENCES_NORMATIVE   # compliance requires the referenced standard
  - REFERENCES_INFORMATIVE # bibliographic / guidance only
  - HARMONIZED_WITH   # equivalent across jurisdictions
  - WITHDRAWN_BY
clause_to_clause:
  - REQUIRES          # clause A cannot be met without clause B
  - MODIFIES
  - EXEMPTS
  - REFERENCES
clause_to_term:
  - DEFINES
  - USES
document_to_org:
  - PUBLISHED_BY
  - MAINTAINED_BY
requirement_to_scope:
  - APPLIES_TO
```

Keep the **stance** concept but repurpose it as `normativity`
(normative | informative | note) or `obligation` (shall/should/may) — it is the
same "how strong is this edge" signal that makes the graph honest.

---

## 5. Stage 3 — Resolve (entity deduplication)

**KYRA location:** `src/kyra/resolve/{resolve_entities,apply_decisions,audit_entities}.py`,
`docs/entity_review.html`, `decisions.json`.

**Flow:** collect every entity name from all `knowledge_object.json` →
`rapidfuzz` fuzzy-cluster variants (per-type thresholds: person 92, org 88,
product 88, concept 85; persons use strict `fuzz.ratio`, others
`token_sort_ratio` on a suffix-normalized string) → send multi-variant clusters
to Claude in batches of 30 to confirm/split and pick a canonical name →
`data/entity_registry.json` (`entity_types`, flat `variant_to_canonical` lookup,
`stats`) → **human review** via a static HTML card UI producing `decisions.json`
(`keep|delete|merge|rename`) → `apply_decisions.py` mutates the registry
(merge unions variants+episodes, rename preserves old name as a variant) with a
`.bak` backup. `audit_entities.py` is a no-write QA gate validating names,
relation ids, and stances against the taxonomy.

### For Stadia-X

Entity resolution stays **highly relevant** — you will have many surface forms
of the same standard (`ISO 19650-1`, `ISO 19650-1:2018`, `BS EN ISO 19650-1`)
and the same term/SDO. Keep the whole flow. Two adjustments:

- **Standards have canonical IDs** — lean on `standard_id` normalization
  (strip prefixes `BS EN`, adoption suffixes, year) as a deterministic key
  *before* fuzzy matching, more reliable than KYRA's name fuzzing.
- **Fix the known bug:** `entity_review.html` exports `merge_into`/`new_name`
  (snake_case) but `apply_decisions.py` reads `mergeInto`/`newName` (camelCase).
  Reconcile before wiring the loop.

---

## 6. Stage 4 — Persist

### 6a. Postgres graph — `src/kyra/graph/pg_ingest.py`

Stock Postgres 16 + pgvector (`docker-compose.yml`, port 5433). Schema created
idempotently inline. This is **relational-modeling-of-a-graph, not a native
graph DB** — no Neo4j/AGE/Cypher.

```sql
episodes(id PK, source, title, date, guest_name, guest_role, guest_org,
         domain, essence, essence_vec vector(768), raw_path, extracted_path)
entities(id PK, canonical, type, variants text[], episode_count)         -- NODES
entity_episodes(entity_id FK, episode_id FK, PK(entity_id, episode_id))  -- membership
chunks(id PK, episode_id FK, chunk_type, text, embedding vector(768), metadata jsonb)
relationships(id serial PK, episode_id FK, subject, relation, object, stance, context) -- EDGES
-- b-tree indexes on chunk/rel/entity columns
```

Ingest is upsert-based (`ON CONFLICT DO UPDATE`), relationships delete-then-insert
per episode. Entities/`entity_episodes` come from `entity_registry.json`.

**Two design smells to fix (see §9):**
1. `relationships.subject`/`object` are **free-text names, not foreign keys** to
   `entities.id`. Traversal is string-matching, not referential — brittle when
   names drift.
2. `essence_vec` and `chunks.embedding` (pgvector columns) are **populated but
   never queried** — a repo-wide grep finds zero pgvector distance operators.
   No HNSW/ivfflat index exists on them. All real vector search happens in
   ChromaDB. This is dead duplication.

### 6b. ChromaDB vectors — `src/kyra/graph/build_index.py`

Persistent ChromaDB, collection `podcast_knowledge`, cosine/HNSW, embedded with
`all-mpnet-base-v2` (CUDA). One JSON is **flattened into typed chunks** — one per
`essence`, `topic`, `insight`, `mental_model`, `assumption`,
`alternative_perspective`, `failure_mode`, `quote`, `prediction` — each carrying
rich metadata (`episode_id`, `episode_title`, `source`, `chunk_type`, `domains`,
`key_concepts`, `speaker`, `timestamp`, …). Chunk id `{slug}::{chunk_type}::{i:04d}`.

### For Stadia-X — chunking is the make-or-break

KYRA chunks by extracted *field* (one chunk per insight). For precise paragraph
retrieval over standards you want **structure-aware chunking**:

- One chunk **per clause/requirement**, with metadata `{standard_id, clause_path,
  heading_trail, page, obligation_type, normativity}`.
- Preserve **parent context** — a clause chunk should know its section. Consider
  parent-document / child-clause chunking so a hit can return the clause *and*
  its surrounding section for context.
- The chunk metadata is exactly what powers "query precisely this standard, this
  clause type" — filterable facets on `standard_id`, `obligation_type`,
  `jurisdiction`, `status`.

---

## 7. Stage 5 — Query (the search engine)

**KYRA location:** `src/kyra/query/*` (all logic, returns dataclasses) +
`src/kyra/api/main.py` (thin FastAPI JSON bridge) + `api/schemas.py` (Pydantic).
Clean service/transport separation — copy this split verbatim.

### 7.1 Hybrid search (`query/search.py`) — the second crown jewel

A 4-stage hybrid pipeline with graceful degradation:

1. **Dense** — ChromaDB cosine, top `DENSE_POOL=50`, returns `1 - distance`.
2. **Sparse** — BM25 (`rank-bm25`) over **canonical tokens** (synonyms collapsed
   so "BIM" == "building information modeling"), top `SPARSE_POOL=50`.
3. **Reciprocal Rank Fusion** — `Σ 1/(RRF_K + rank)` (`RRF_K=60`) across both
   rankings, plus an **exact-phrase bonus** (`+0.02`) when the verbatim query
   appears in the doc.
4. **Cross-encoder rerank** — lazy `cross-encoder/ms-marco-MiniLM-L-6-v2`,
   sigmoid over logits. If the model is unavailable, falls back to normalized RRF.

Then an **additive structural blend** — this is the load-bearing formula:

```
field_boost = min(1.0, Σ FIELD_WEIGHTS[matched_field] / 2.0)   # title 1.0, speaker 1.0, tag 0.6
structural  = 0.40·coverage + 0.25·phrase_ratio + 0.35·field_boost
final       = 0.60·r + 0.40·structural        # r = rerank score (or RRF fallback)
displayed   = round(final · 100, 1)           # the displayed score IS the sort key
```

Every hit exposes a **transparent score breakdown** (`score`, `semantic`,
`lexical`, `coverage`, `terms_matched/total`, `phrases_matched/total`,
`matched_terms/phrases/fields`) — the UI renders this so relevance is auditable.

### 7.2 Query expansion (`query/synonyms.py` + `shared/query_synonyms.yaml`)

Synonym/acronym groups (first form = canonical). `canonical_tokens()` collapses
surface forms uniformly across corpus tokens, query tokens, field tokens, and
highlighting, so acronym ⇄ expansion matching is consistent everywhere.

### 7.3 Endpoints (FastAPI, all GET, `@lru_cache` singletons)

`/search`, `/facets`, `/episodes/{id}`, `/source` (transcript provenance +
grounding/hallucination score), `/entities` + `/entities/{name}`,
`/graph/neighborhood` (BFS, 1–2 hops), `/graph/path` (shortest path),
`/relations` + `/relations/{relation}`, `/themes` (co-occurrence, contradictions),
`/stats`, `/health`. Config via `pydantic-settings` (`KYRA_` env prefix, `.env`).

### For Stadia-X

**Keep the hybrid ranking wholesale** — it is exactly what "query precisely"
needs, and the transparent score breakdown is a real asset for a compliance
context where users must trust why a clause surfaced. Adaptations:

- Re-point `FIELD_WEIGHTS` at standards fields: boost `standard_id`, `clause_path`,
  `defined_term`, `heading`. A query term matching a clause heading should
  outrank an incidental body mention.
- Rebuild `query_synonyms.yaml` for your domain's acronyms (the KYRA file is
  AEC-specific: BIM, IFC, CDE… — some may even carry over).
- Add **hard filters** as first-class query params: `standard_id`, `publisher`,
  `jurisdiction`, `status=active`, `obligation_type`. Precise retrieval over
  standards is filter-heavy, not just semantic.
- The `/source` grounding check (verify an extraction against its source text)
  is *very* valuable for standards — it lets you prove a requirement was not
  hallucinated. Keep it and anchor it to `clause_path`.

---

## 8. Stage 6 — Studio (front-end)

**KYRA location:** `studio/` — Next.js 16 / React 19, Tailwind v4, TanStack
Query, **Sigma.js + graphology** (WebGL) for the graph, cmdk palette, Vercel AI
SDK for the write-side. Thin typed client (`lib/api.ts`) over the FastAPI
contract; `NEXT_PUBLIC_API_URL` points at `:8000`.

Surfaces: **Search** (faceted, min-score slider, synonym note, per-hit score
rail), **Graph** (neighborhood-first Sigma viz, never dumps the full graph),
**Entity** profile, **Connect** (shortest path between two entities), **Themes**,
**Overview** (stats). A `Work`/`Calendar` write-side exists as a file-backed
placeholder.

### For Stadia-X

The frontend is a **thin, replaceable adapter** — reproduce the FastAPI contract
and the Studio is portable. Rename surfaces to the domain: Search → clause
search; Entity → standard profile (its clauses, what it references, what
supersedes it); Connect → "reference path between two standards"; Themes →
"terms defined across the corpus / conflicting requirements". The
neighborhood-first graph is the right call for a dense cross-reference network.
The write-side (`lib/work/`) is isolable — drop it unless you need authoring.

---

## 9. Judgement — enterprise-grade vs. improvable

### Copy verbatim (genuinely production-grade)

| Part | Why it is enterprise-grade |
|---|---|
| **Extraction harness** (`extract_knowledge.py`) | Checkpoint/resume, thread-pool + API semaphore, budget hard-cap, retry/backoff, preflight, dry-run cost estimation, dead-letter queue, schema-hash versioning, JSONL logging. This is how a real batch-LLM system is built. |
| **Hybrid search** (`query/search.py`) | Dense + BM25 + RRF + cross-encoder rerank + field boosting + synonym canonicalization, with graceful degradation and a fully transparent, auditable score breakdown. Rare to see done this completely. |
| **Service/transport separation** | All logic in `query/` returning dataclasses; FastAPI is a pure JSON bridge; Pydantic contract in one file. Clean, testable, UI-agnostic. |
| **Idempotent upsert ingest** | Every stage re-runnable; `ON CONFLICT DO UPDATE`; `--reset` to rebuild. |
| **Human-in-the-loop resolution** | Fuzzy → LLM → review UI → apply-decisions with backups is a sound, auditable dedup loop. |
| **Contract-driven prompts** | Taxonomies rendered from YAML into prompts; schema hash ties every output to its contract version. |

### Works, but redesign for Stadia-X

| Part | Problem | Recommendation |
|---|---|---|
| **Two vector stores** | pgvector columns are populated but never queried; all search is in ChromaDB. Dead duplication, two systems to keep in sync. | **Consolidate onto one store.** See §10. |
| **Graph edges as free-text** | `relationships.subject/object` are strings, not FKs to `entities.id`; traversal is string-match. | Resolve subject/object to entity IDs **at ingest** (you already have the registry). Edges become FK-linked → real referential traversal, recursive CTEs, no name-drift breakage. Essential for a precise cross-reference graph. |
| **Relational-as-graph** | Fine for 1–2 hop neighborhoods; awkward for deep multi-hop "what transitively references this clause". | With FK edges + recursive CTEs, Postgres handles most of it. If reference-chain traversal becomes central, add **Apache AGE** (Postgres graph/Cypher extension) or Neo4j — but start with CTEs. |
| **Schema duplicated** (YAML ↔ Python dicts) | Hand-kept in sync; only byte-hashed, not parsed. | Parse the YAML `output_template` at runtime, or generate the Python schema from it. One source of truth. |
| **Chunking by field** | One chunk per insight; loses document structure. | Structure-aware chunking (clause-level + parent context + structural anchor). This is what makes "precise paragraph" retrieval work. |
| **Free-text `domains`** | LLM emits uncontrolled tags; `taxonomy/*.yaml` vocabularies exist but aren't enforced. | Constrain classification fields to the controlled vocab (pass the enum into the prompt, validate against it). |
| **Config partly hardcoded** | Legacy app + `pg_ingest.py` hardcode the DSN; new `query/` layer uses pydantic-settings. | Route every stage through the pydantic `Settings` object. |
| **No pgvector index** | Even where pgvector is written, no HNSW/ivfflat index. | Add `USING hnsw (embedding vector_cosine_ops)` if you keep pgvector (§10). |
| **`entity_review.html` key mismatch** | `merge_into`/`new_name` vs `mergeInto`/`newName`. | Fix the export keys. |

---

## 10. Database recommendation for Stadia-X

You explicitly asked whether a more adequate database type applies. Here is the
call.

**Consolidate on Postgres as the single store — drop ChromaDB.** KYRA runs two
databases and only half-uses both. For Stadia-X, Postgres alone can do
everything, with one system to operate and transactional consistency between the
graph and the vectors:

- **Relational graph** — `standards`, `clauses`, `terms`, `organizations` (nodes)
  and `references`/`relationships` (edges, **FK-linked** to node ids). Multi-hop
  reference chains via **recursive CTEs**.
- **Semantic search** — `pgvector` with a proper **HNSW cosine index** on clause
  embeddings. Same recall as ChromaDB for a corpus this size.
- **Lexical / BM25** — Postgres full-text (`tsvector` + GIN + `ts_rank`) covers
  the sparse side. If you want *true* BM25 in-database, use **ParadeDB /
  `pg_search`** (a Postgres extension providing BM25 over a `bm25` index) — then
  the entire hybrid pipeline from §7 runs on one engine.
- **Flexible document metadata** — `jsonb` columns for the parts of standards
  that vary by publisher.
- **Faceted filtering** — plain indexed SQL `WHERE` on `standard_id`,
  `jurisdiction`, `status`, `obligation_type`.

Net: `pgvector` (+ optionally `pg_search`) **replaces ChromaDB entirely**, and
FK-linked edges + recursive CTEs replace the string-matched graph. You keep
KYRA's hybrid-ranking algorithm unchanged — only the retrieval calls point at
Postgres instead of two stores.

**When to add a native graph DB:** only if traversal becomes the product — deep
transitive reference resolution, "shortest compliance path across 6 standards",
graph algorithms at scale. Then add **Apache AGE** (keeps everything in Postgres)
before reaching for Neo4j. Do not start there; recursive CTEs over a clean FK
edge table cover the first version.

**Keep as-is:** `all-mpnet-base-v2` (768-dim) is a fine default embedding model;
swap only if a domain-tuned or larger model measurably helps on your eval set.

---

## 11. Build order for Stadia-X

1. **Contracts first** (`shared/`) — write the Stadia-X `document/clause` schema,
   the standards `relation_taxonomy.yaml`, and `query_synonyms.yaml`. These drive
   everything downstream.
2. **Ingest** — one `DocumentLoader` base + one real source; parse PDF/DOCX/HTML
   into structure-preserving normalized JSON (clause_path, page, heading_trail).
3. **Extract** — copy `extract_knowledge.py` wholesale; swap the three `*_SCHEMA`
   dicts and prompts for the document/clause schema; keep all the infra
   (checkpoint/budget/retry/dead-letter/schema-hash/logging).
4. **Resolve** — copy the resolve/apply/audit trio; add `standard_id`
   normalization as a deterministic pre-key; fix the review-UI key mismatch.
5. **Persist** — single Postgres schema: nodes + **FK-linked** edges + clause
   chunks with `pgvector` (HNSW index) and `tsvector`/`pg_search`. No ChromaDB.
6. **Query** — copy the `query/` service layer and the hybrid-ranking algorithm;
   re-point retrieval at Postgres; re-weight `FIELD_WEIGHTS`; add hard filters
   (`standard_id`, `status`, `obligation_type`). Keep the FastAPI bridge and the
   transparent score breakdown.
7. **Studio** — copy the Next.js app; re-point the client; rename surfaces to the
   standards domain. Optional/last.

---

## 12. Dependencies & infra reference

**Keep:** `anthropic`, `google-genai` (LLM); `rapidfuzz` (resolve);
`sentence-transformers`, `pgvector`, `rank-bm25` (search — BM25 optionally
replaced by `pg_search`); `psycopg[binary]`, `fastapi`, `uvicorn`,
`pydantic-settings`, `networkx` (or drop for CTEs); `pyyaml`. Front-end:
Next.js 16, React 19, Tailwind 4, TanStack Query, Sigma.js + graphology.

**Drop for Stadia-X:** `torch`/`torchaudio`/`torchvision`, `faster-whisper`,
`pyannote.audio`, `simple-diarizer`, `pydub`, `ffmpeg-python`, `yt-dlp`,
`huggingface-hub<1.0` pin, CUDA requirement — the entire audio stack.
Likely drop `chromadb` (consolidate on pgvector) and `gradio` (legacy app).

**Add for Stadia-X:** a layout-aware document parser (`PyMuPDF` / `unstructured`
/ `docling`, or Azure Document Intelligence for scanned PDFs); optionally
`pg_search`/ParadeDB for in-database BM25; optionally Apache AGE for native graph
queries.

**Infra:** Postgres 16 (Docker, port 5433 in KYRA — pick your own); FastAPI on
:8000; Studio on :3000. Env-driven config via `pydantic-settings` /
`NEXT_PUBLIC_API_URL`.
