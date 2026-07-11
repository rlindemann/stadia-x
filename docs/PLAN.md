# Stadia-X — Build Plan

This plan reconciles the two blueprints in `docs/` into what Stadia-X actually
builds. Read this first.

- `STADIA_X_REPLICATION.md` — the **retrieval-first** approach (from KYRA).
- `REPLICATION_GUIDE_stadia-x.md` — the **semantic-web** approach (from DeixOn).

Both describe the same shape of pipeline (ingest → extract → persist → query),
and both are valid. They differ in what they optimise for. Stadia-X takes the
crown jewel of each.

---

## 1. Goal

A corpus of policy documents and standards, queryable **precisely** — down to the
exact clause / paragraph of the exact standard — by three complementary means at
once: **structure** (this clause supersedes that one), **wording** (lexical), and
**meaning** (semantic). Every answer must be traceable to its source page and
carry a stable, versioned identity.

That triple requirement — structure + wording + meaning + provenance — is exactly
why neither blueprint alone is enough, and why the two are complementary rather
than alternatives.

---

## 2. The two approaches, and what each is really good at

| | Approach A — Retrieval-first (KYRA) | Approach B — Semantic-web (DeixOn) |
|---|---|---|
| **Core question it answers** | "Find me the right paragraph" | "Prove this is exactly clause X of standard Y, versioned and cited" |
| **Extraction** | Production multipass LLM harness: checkpoint/resume, budget hard-cap, retry/backoff, dead-letter queue, schema-hash versioning, JSONL logging | Per-document LLM extractor with a **calibration gate** (>=95% on labelled ground truth before full run) and a **verbatim-faithful** constraint |
| **Identity / provenance** | Weak — free-text names, no versioned IDs | **Strong** — globally unique, dereferenceable, versioned URIs + source anchoring (exact PDF page/paragraph deep link, extraction confidence/date/tool) |
| **Storage** | Postgres graph + ChromaDB vectors (two stores, half-used) | RDF/Turtle in a SPARQL triplestore (Fuseki/TDB2) |
| **Retrieval** | **Best-in-class hybrid search**: dense + BM25 + Reciprocal Rank Fusion + cross-encoder rerank + field boosting + synonym canonicalization, with a fully transparent, auditable score breakdown | **None** — exact-match SPARQL `FILTER` only. Its own doc flags this as the single biggest gap |
| **Validation** | Schema-hash + preflight | **Dual**: SHACL structural conformance + SPARQL competency questions + OWL consistency (ROBOT/HermiT), each CI-friendly |
| **Method discipline** | Ad-hoc schema | **6-stratum KOS**, standards-anchored (Z39.19 / ISO 11179 / ISO 25964 / OWL 2 / RDF); vocabulary and taxonomy **before** ontology; every class must earn its place via a competency question |
| **Serving** | FastAPI service layer + Next.js studio (search, graph, entity, path, themes) | SPARQL CLI + saved `.rq` query library + Next.js SPARQL proxy; Dockerised triplestore on Railway |

**The honest summary:** Approach A is a superb *retrieval engine* with a weak
*knowledge model*. Approach B is a rigorous *knowledge model* with no *retrieval
engine*. Stadia-X needs both.

---

## 3. Where the two approaches already agree

This is the key insight. When each doc critiques itself and recommends its
*improved* form (both docs' section 9/10), they converge on the same target:

- Approach A §10: "Consolidate on **Postgres** as the single store — `pgvector`
  (HNSW) for semantic, `tsvector`/`pg_search` for lexical, **FK-linked** graph
  edges + recursive CTEs. Add Apache AGE only if deep traversal becomes the
  product."
- Approach B §10 (simplest single-store option): "**Postgres + Apache AGE
  (graph) + `pgvector` (embeddings) + `tsvector` (full-text)** — one database,
  one set of backups, far simpler ops. Keep Turtle (`.ttl`) as the portable
  interchange format."

Both independently arrive at **one Postgres carrying graph + vectors +
full-text**. That is the store decision, made for us by two lineages agreeing.

---

## 4. What Stadia-X takes from each

**From Approach A (copy the engineering):**
- The extraction harness verbatim — checkpoint/resume, thread-pool + API
  semaphore, budget hard-cap, retry/backoff, preflight, dry-run cost estimate,
  dead-letter queue, schema-hash versioning, JSONL run logs.
- The hybrid ranking algorithm verbatim — dense + BM25 + RRF + cross-encoder +
  field boost + synonym canonicalization, with the transparent score breakdown
  (essential for a compliance context where users must trust *why* a clause
  surfaced).
- The service/transport split — all logic in a query layer returning
  dataclasses; FastAPI as a thin JSON bridge; one Pydantic contract file.
- The Next.js studio as a thin, replaceable adapter over that contract.

**From Approach B (copy the discipline and the model):**
- **Identity policy** — every entity gets a versioned, dereferenceable URI, and
  every extracted item carries a **structural + source anchor**
  (`standard_id`, `clause_path`, page, physical PDF page, deep link,
  extraction confidence/date/tool). This is the golden thread that makes
  paragraph-level precision real. Centralise URI minting in one module.
- **Method order** — do S1-S4 (controlled vocabulary → metadata fields →
  taxonomy → cross-reference thesaurus) *before* any formal ontology. Every
  concept must be demanded by a real competency question. No beautiful
  hierarchies that answer nothing.
- **Verbatim-faithful extraction** — the prompt forbids paraphrase of source
  text. Non-negotiable for standards.
- **The calibration gate** — hand-label ~20 ground-truth clauses; the classify /
  extract step exits non-zero unless it clears the accuracy bar before the full
  corpus runs.
- **Dual validation** — competency-question SPARQL/SQL checks ("clause count ==
  N", "every clause has a code", "all URIs conform") + structural shape checks,
  both with exit codes for CI.
- **Turtle as portable interchange** — export the graph to `.ttl` so we are never
  locked to Postgres and can feed SPARQL/OWL tooling if a formal-compliance need
  appears later.

---

## 5. Stack decision

**Primary store: one PostgreSQL 16 instance.**
- Graph nodes (`standards`, `clauses`, `terms`, `organizations`) and **FK-linked**
  edges (`references`, `relationships`). Multi-hop reference chains via recursive
  CTEs. Add **Apache AGE** only if deep transitive traversal becomes the product.
- Semantic: `pgvector` with an **HNSW cosine index** on clause embeddings
  (`all-mpnet-base-v2`, 768-dim to start).
- Lexical: Postgres full-text (`tsvector` + GIN), upgrading to **`pg_search`**
  (ParadeDB) if we want true in-database BM25 so the whole hybrid pipeline runs
  on one engine.
- Facets: plain indexed `WHERE` on `standard_id`, `publisher`, `jurisdiction`,
  `status`, `obligation_type`.
- Varying per-publisher metadata: `jsonb`.

**Interchange: Turtle export** of the graph, so the semantic-web toolchain
(SHACL/SPARQL/OWL) remains available without running it as the live store.

**Decided:** Stadia-X is an internal tool for querying policy and standards
reliably. There is no requirement for formal OWL reasoning or a public SPARQL
endpoint, so we do **not** run Fuseki. Postgres is the single store; Turtle
export stays as a portability escape hatch only. We keep Approach B's *discipline*
(versioned URIs, source anchoring, verbatim-faithful extraction, calibration gate,
competency-question-driven scope, dual validation) without its *infrastructure*.

---

## 6. Data model (first cut)

Each extracted clause is one row and one embedding, carrying its full anchor:

```
standards(id PK, standard_id, title, publisher, version, status,
          jurisdiction, effective_date, supersedes, source_url, meta jsonb)
clauses(id PK, standard_id FK, clause_path, heading_trail, page, pdf_file_page,
        block_type, obligation_type, normativity, verbatim_text,
        embedding vector(768), tsv tsvector, uri, meta jsonb)
terms(id PK, term, definition, defined_in_clause FK)
organizations(id PK, name, role)
references(id PK, from_clause FK, to_standard FK NULL, to_clause FK NULL,
           reference_type)              -- FK-linked edges, not free-text
relationships(id PK, subject_id FK, relation, object_id FK, normativity)
```

Relation vocabulary comes from a rendered YAML taxonomy (Approach A's pattern),
using Approach B's standards-appropriate relations: `SUPERSEDES`, `AMENDS`,
`REFERENCES_NORMATIVE`, `REFERENCES_INFORMATIVE`, `HARMONIZED_WITH`, `REQUIRES`,
`DEFINES`, `APPLIES_TO`, etc.

---

## 7. Build order

1. **Contracts + vocabulary first** (`shared/`) — the clause/document schema, the
   standards relation taxonomy, query synonyms, and the S1-S4 controlled
   vocabulary/taxonomy. Pick 2-3 representative source docs and one competency
   question each to drive scope.
2. **Ingest** — one `DocumentLoader` base + one real source. Parse PDF/DOCX/HTML
   with a layout-aware parser (PyMuPDF to start) into structure-preserving JSON:
   ordered blocks with `clause_path`, `heading_trail`, `page`, `block_type`,
   verbatim text. Mint URIs and source anchors here.
3. **Extract** — the multipass LLM harness with all its infra; swap in the
   document/clause schema; enforce verbatim-faithful; add the calibration gate.
4. **Resolve** — fuzzy + LLM + human-review dedup, with deterministic
   `standard_id` normalization as a pre-key (strip `BS EN`, adoption suffixes,
   year) before fuzzy matching.
5. **Persist** — the single Postgres schema above: FK edges, pgvector HNSW,
   tsvector. Export Turtle. Run the dual validation gate.
6. **Query** — the hybrid ranking algorithm re-pointed at Postgres; re-weight
   field boosts for standards fields (`standard_id`, `clause_path`, defined term,
   heading); add hard filters as first-class params; keep the transparent score
   breakdown and a `/source` grounding check anchored to `clause_path`.
7. **Studio** — the Next.js app re-pointed at the contract; surfaces renamed to
   the domain (clause search, standard profile, reference path, defined terms /
   conflicts). Optional / last.

Do not write formal OWL until the vocabulary and taxonomy (step 1) are clean —
Approach B's hard rule, and it holds here.

---

## 8. Open decisions for you

Store decided: **Postgres-primary, no Fuseki** (internal tool, no OWL/SPARQL
requirement). Remaining:

1. **First corpus:** which 2-3 standards/policy docs do we build against first,
   and what is the one competency question for each? This drives the schema.
2. **Source formats:** mostly born-digital PDFs, or scanned/complex layouts (the
   latter may need Azure Document Intelligence rather than PyMuPDF)?
3. **Studio now or later:** build the FastAPI contract only for now, or the
   Next.js UI too?
