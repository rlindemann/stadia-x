---
type: lab-child
parent: 2026-07-19-aec-extraction-pipeline
date: 2026-07-19
status: draft
tags: [extraction, schema, deixon, kyra, stadia-x, policy]
---

# Extraction build spec — unified substrate for Deixon, stadia-x, Kyra + policy

**Purpose.** One extraction build, four extractors, one shared knowledge substrate (graph DB + vector store). Each extractor section ends with a **Still missing** list — extend these as gaps surface; that list *is* the improvement backlog per source.

**Honesty note.** Deixon and Kyra details below are reconstructed from prior chat sessions and may be out of date — verify against current code. stadia-x has no prior context in the vault or chats; its section is a placeholder to be filled in.

---

## 1. Target substrate (what everything extracts INTO)

Two stores, one logical model:

- **Graph DB** — structure, ancestry, cross-references, entities. (Neo4j or Fuseki — undecided; see session note. Schema below is store-agnostic.)
- **Vector store** — leaf chunks with embeddings + denormalized metadata payload for pre-filtering. (Index auto-built; HNSW default.)

### 1.1 Canonical node types

| Node | Meaning | Examples |
|---|---|---|
| `Source` | An origin system/corpus | london-plan-2021, kyra/trxl, deixon-scrape, stadia-x |
| `Document` | A versioned container | London Plan 2021, TRXL ep. 184, a firm's website snapshot |
| `Section` | Structural level(s) inside a document | Chapter 3, Policy D6, podcast segment, page/bucket |
| `Chunk` | The leaf retrieval unit — the ONLY thing embedded | Policy D6 Part B(3), an utterance span, a project description |
| `Entity` | A real-world thing chunks refer to | Policy ref, firm, person, standard, place, topic |

### 1.2 Canonical edges

- `HAS_PART` — Document → Section → … → Chunk (the chunk hierarchy)
- `CITES` — unit → unit across documents (Policy D6 → NPPF para; podcast guest → ISO 19650)
- `MENTIONS` — Chunk → Entity (extracted references)
- `SUPERSEDES` — Document/Section version lineage
- `APPLIES_TO` — policy/standard unit → Entity (jurisdiction, building type, discipline)
- `SAME_AS` — entity resolution across sources (the Deixon "Foster + Partners" node = the Kyra mention)

### 1.3 Canonical chunk payload (vector store side)

```json
{
  "chunk_id": "lp2021-d6-B-3",
  "source": "london-plan-2021",
  "text": "…",
  "ancestry": ["London Plan 2021", "Chapter 3", "Policy D6", "Part B"],
  "text_type": "policy | supporting | transcript | summary | scraped",
  "status": "adopted | draft | superseded | live",
  "date": "2021-03-02",
  "entities": ["policy:D6", "topic:internal-space"],
  "lang": "en"
}
```

Rule: **every extractor must emit this shape.** If an extractor can't fill `ancestry` or `status`, that's a gap for its Still-missing list, not a schema change.

---

## 2. Extractor A — Policy & standards (NEW — the build this lab started from)

**Corpus:** London Plan 2021 (+ emerging replacement — verify current GLA status), NPPF, Approved Documents, ISO 19650 series (⚠ licensed — internal use only, check terms), later borough Local Plans.

**Pipeline:**
1. Fetch source documents (GLA HTML for London Plan — verify current format; PDFs for ISO/Approved Docs → pdf extraction with layout awareness).
2. Parse structure: chapter → policy → lettered part → numbered sub-paragraph. Preserve the **policy-box vs supporting-text** distinction as `text_type`.
3. Chunk at lettered-part level by default; split long parts to sub-paragraphs.
4. Extract cross-references (regex + LLM pass for "in accordance with Policy H2", "see NPPF paragraph 60") → `CITES` edges.
5. Emit canonical chunks + graph nodes; embed leaves.

**Still missing (initial list — extend here):**
- [ ] Version/supersession model wired to real adoption dates (`SUPERSEDES` chain, adopted vs draft)
- [ ] `APPLIES_TO` extraction (jurisdiction, use class, building type) — currently manual
- [ ] Table and figure handling in Approved Documents (space standards tables are the payload, not prose)
- [ ] Defined-terms glossary as Entity nodes ("major development" has a legal definition — link every use)
- [ ] Borough Local Plans ingestion

---

## 3. Extractor B — Deixon (external AEC data)

**What exists (from prior sessions — verify):** an architecture-firm website scraper (scrape-first-to-JSON, then local filtering), content bucketing/categorization (projects, services, …) with keyword + TF-IDF semantic bucketing; conceptual work on capturing "decision events" in practice.

**Role in this build:** Deixon extraction = the *external* AEC layer — firms, projects, services, sectors — that internal project/office data and policy nodes connect to.

**Mapping to canonical schema:**
- Firm website snapshot → `Document` (dated — snapshots enable `SUPERSEDES`)
- Bucket (projects/services/…) → `Section`
- Individual project/service description → `Chunk`
- Firm, project, sector, location → `Entity` nodes; `MENTIONS` edges from chunks

**Still missing (initial list — extend here):**
- [ ] Entity resolution: firm/project names normalized into stable Entity IDs (`SAME_AS` across sources)
- [ ] Ancestry + provenance on every scraped chunk (URL, fetch date, snapshot ID) — required for the canonical payload
- [ ] Link layer to policy: which policies `APPLIES_TO` a project's location/type (this is where the policy graph pays off for Deixon)
- [ ] Decision-event extraction as first-class nodes (currently conceptual, not extracted)
- [ ] Re-scrape/diff strategy → `SUPERSEDES` between snapshots instead of overwrite

---

## 4. Extractor C — Kyra (podcast / longform)

**What exists (from prior sessions — verify):** TRXL episode scraper (transcript + metadata from trxl.co), Blinkist-style summarizer (brief/standard/detailed), taxonomy classifier (domains/topics/themes), embeddings step; folder pipeline `data/raw → processed`.

**Mapping to canonical schema:**
- Episode → `Document` (metadata: title, date, guest)
- Topical segment → `Section` (currently missing — see gaps)
- Transcript span → `Chunk` (`text_type: transcript`); summaries → separate chunks (`text_type: summary`) linked to the episode, never mixed into transcript retrieval
- Guest, host, firm, tool, standard mentioned → `Entity` + `MENTIONS`

**Still missing (initial list — extend here):**
- [ ] Segment layer: transcripts are currently flat — need topical segmentation so chunks get real ancestry (Episode → Segment → Span)
- [ ] Speaker attribution per chunk (who said it — critical for citing opinions vs facts)
- [ ] Timestamps on chunks (deep-link back to audio)
- [ ] Claim/insight extraction as typed chunks (the "Longform Atlas" promise — currently only summaries)
- [ ] Entity linking into the shared registry (a mention of "ISO 19650" should hit the *same* node the policy extractor created — this is the whole point of the unified build)
- [ ] Taxonomy → shared topic Entity nodes (stop keeping a private Kyra taxonomy)

---

## 5. Extractor D — stadia-x (FILLED IN 2026-07-19 from the live build)

**What it is:** an internal tool that ingests sports-facility **standards** PDFs and makes them queryable *down to the exact clause*. Live corpus: AFC Stadium Regulations, 3 editions (2021 / 2026 / 24051), 701 clauses. Stack: Next.js studio + one Postgres (pgvector **HNSW** + tsvector) + Voyage embeddings + Claude extraction/answers + Cloudflare R2 for source PDFs and rendered figures. This is the **most mature retrieval layer of the four** — copy from it, don't rebuild it.

**Mapping to canonical schema:**
- Standard → `Document` (versioned; `status` Current/Superseded; `SUPERSEDES` chain across editions)
- heading/article hierarchy → `Section` — currently encoded in `clause_path` + `heading_trail` **strings**, not nodes (gap)
- Clause / paragraph → `Chunk` (the ONLY embedded unit) — `verbatim_text`, obligation_type, normativity, page + physical PDF page + deep link
- Defined terms → partial `Entity` layer (`terms` + `defines_term` edges); no general entity registry
- Cross-references → `CITES` (`refs` + `reference` edges; only ~19/180 resolve — corpus-coverage limited, not a tech limit)

**Ahead of this spec (reference implementations for the other three):**
- **Hybrid retrieval** — dense + full-text + a **hypothetical-questions index** (3-5 LLM questions per clause, embedded) fused with RRF, plus a transparent per-signal "why it matched" breakdown, glossary-definition de-ranking, and a query-time synonym bridge.
- **Multimodal tables/figures** — the ✓/△/✗ compliance matrices are detected (vector-drawing regions), rendered, vision-transcribed, embedded, and searchable. (The policy extractor lists this as *Still missing*.)
- **Provenance** — every clause carries extractor id + timestamp.
- **Approved-Q-A eval harness** (`studio/eval/`) — scores live Search + Ask against curated pairs; the trust/regression layer.

**Still missing (the backlog):**
- [ ] **`APPLIES_TO` edges — highest value, unique to stadia-x.** The ✓/△/✗ matrices are literally `APPLIES_TO(clause → Stadium Category A-E)` + modality (mandatory / best-practice / non-applicable), but they live only as free text in `clause_figures.transcription`. So "what must a Category B stadium comply with?" is unanswerable by query. This is the one competency question that should drive the model.
- [ ] Entity registry + `MENTIONS` + `SAME_AS` — stadia-x is a silo; referenced external standards (Laws of the Game, AFC Statutes) should be shared Entity nodes the other extractors also hit.
- [ ] `Section` nodes + `HAS_PART` (currently string-encoded ancestry only).
- [ ] Never-delete versioning — the loader deletes+reinserts clauses on reload, violating §6.4.
- [ ] A formal competency-question set (only approved-Q-A pairs exist so far).

---

## 6. Cross-source glue (the part no single extractor owns)

1. **Entity registry** — one namespace for Entity IDs; every extractor resolves against it (exact match → alias table → LLM-assisted fuzzy match with human review queue).
2. **Ingestion contract** — extractors write canonical JSONL; a single loader owns graph writes + embedding + vector upserts. Extractors never touch the DBs directly.
3. **Provenance** — every chunk carries source, fetch/publication date, extractor version. Non-negotiable for a policy-adjacent system.
4. **Versioning** — `SUPERSEDES` everywhere; never delete, always supersede.

## 7. Build order (proposed)

1. Canonical schema + loader (§1, §6.2) — small, do first, everything depends on it
2. Extractor A (policy) end-to-end on the London Plan only — proves the hierarchy + retrieval
3. Retrofit Kyra output to the canonical shape (cheapest existing pipeline to adapt)
4. Retrofit Deixon scraper output; stand up entity registry when the first cross-source `SAME_AS` is needed
5. stadia-x is already built — it is the **retrieval + eval reference** (see §5, §8). Copy its patterns *into* A/C/D rather than reinventing them.

---

## 8. Retrieval & quality intelligence (proven on stadia-x — apply to every extractor)

Self-contained so this spec can be copied into any repo. These are the transferable
learnings from the stadia-x build (clause-level RAG on Postgres), not stadia-x plumbing.

### 8.1 Three "questions" that get conflated — keep them separate

| Artifact | What | Job | When |
|---|---|---|---|
| **Anticipated / hypothetical questions** | LLM auto-writes 3-5 questions each chunk *answers*; stored **question-only** (chunk is the answer), embedded next to the chunk | **retrieval recall** — a user query IS a question, so query→question beats query→prose | index-time (rides the extraction pass) |
| **Approved Q-A pairs** | Human-vetted: question + verified answer + source chunk | **trust / regression** — measure accuracy, catch regressions | eval-time |
| **Competency questions** | Questions the whole system MUST answer; span many chunks | **scope / coverage** — decide what the *model* must support; unanswerable = a modeling gap | design-time |

One-liner: anticipated = signpost (findability); approved Q-A = exam question with answer key (scoreability); competency = the syllabus (what to model). Each extractor keeps its own `pairs.json` (approved) and `competency-questions.md` (tagged OK/PARTIAL/GAP); stadia-x's live in `studio/eval/` as the worked example.

### 8.2 The approved-Q-A eval harness (the pattern)

A tiny script that hits the **live** Search/Answer endpoints with curated pairs and prints numbers. Pair shape: `{ q, clauses:[acceptable source ids], facts:[key phrases] }`; add `"abstain": true` for out-of-scope questions — the answerer MUST refuse (`sufficient:false`), not invent. Metrics: retrieval **found@K / hit@1 / hit@5 / MRR**; answer **cites-correct + facts-present + sufficient**. Non-zero exit on hard failure so it gates CI. Run after every ranking/prompt change — turns "feels right" into a number. Gotchas: compare `[[id]]` citation markers **as strings** (Postgres returns bigints as strings); a heading + its `.1` sub-clause may be merged under the parent path, so verify the real id when curating.

### 8.3 Search-quality levers (evidence-driven, from real misses)

- **De-rank glossary definitions** below substantive clauses (~0.7x on the fused score) — definitions are short and keyword-dense so they outrank the requirement on a topic search. Apply the multiplier to the *returned* score too, so the relevance bar stays monotonic with rank.
- **Synonym bridge across editions/vocabularies** — when a doc renames a concept between versions, OR a hand-curated synonym group into the **lexical** query (not the semantic vector), both directions. Confirm the exact corpus surface form first; skip acronyms not actually used.
- **Vector index = HNSW** (pgvector, cosine). A "metric tree" (KD/ball/VP/cover) is a different, older ANN family that collapses at high dimensions — don't use it for modern embeddings.
- **Why-it-matched transparency** — surface concrete match signals (meaning / wording / answered-a-question / table) and highlight query terms in the snippet. Essential where users must trust *why* a result surfaced.

### 8.4 The APPLIES_TO lesson (modeling, not retrieval)

Matrix/table payloads carry the real `APPLIES_TO` structure — extract it as **edges, not prose**. stadia-x extracts ✓/△/✗ compliance matrices but only as free-text figure transcriptions, so "what must a Category B stadium comply with?" is unanswerable by query. A competency question ("everything that applies to X") is the signal you're missing this.
