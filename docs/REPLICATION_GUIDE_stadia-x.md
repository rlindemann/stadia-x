# Policy-Corpus → Graph → Query: Replication Guide

A complete, copy-into-another-repo description of the extraction → graph-database →
query workflow used in the DeixOn repo, written so you can regenerate the same
functionality for **stadia-x** (a large corpus of policy documents and standards that
must be extracted, stored in a graph database, and queried precisely down to the
paragraph / clause / standard level).

It has two parts:

1. **The system as built** — every layer, the actual files, how they chain.
2. **Judgement** — what is enterprise-grade and worth copying verbatim, what works here
   but should be improved for a larger corpus, and a concrete database recommendation.

---

## 1. What the system does, in one paragraph

Source documents (PDFs, or a published technical schema) are turned into a **structured
entity database** (JSONL), then into **RDF/Turtle** conforming to an OWL ontology, then
loaded into a **SPARQL triplestore** (Apache Jena Fuseki), and exposed through a
**SPARQL query interface** (CLI, a Next.js web app, and saved parameterised queries).
Every entity gets a **globally unique, dereferenceable, versioned URI** and carries
**provenance** back to the exact page/paragraph of the source. Validation is done twice:
**SHACL shapes** (structural conformance) and **SPARQL competency queries** (does the
graph answer the questions it was built to answer). The whole triplestore ships as a
**Docker image deployed on Railway** with a public read-only endpoint and an internal
write endpoint.

---

## 2. Architecture at a glance

```
SOURCE DOCS                 INGESTION                     KNOWLEDGE LAYER            SERVING
───────────                 ─────────                     ───────────────           ───────

                     ┌─ Path A: LLM extraction ─┐
 PDF ──PyMuPDF──▶ text ─regex─▶ sections ─LLM──▶ JSONL ──▶ TTL (rdflib/           ┌─ Fuseki (TDB2)
 (London Plan,        (boundary   (Anthropic      │        f-string templating)   │   SPARQL 1.1
  NPPF, …)             detection)  structured      │             │                 │   endpoint
                                   extraction)     │             ▼                 │      ▲
                     ┌─ Path B: schema lift ────┐  │        SHACL shapes           │      │
 Published    ──────▶ deterministic lift ──────▶ TTL       (T1 Violation,          │      │ Graph Store
 schema (GLA          (01_lift_schema.py:         │         T2 Warning, …)          │      │ Protocol
 PLD v2.1)            enums→SKOS, fields→props,    │             │                  │   POST /data
                      dot-nesting→taxonomy)        │             ▼                  │
                                                   │        VALIDATION              │
                                          ┌────────┴──┐   pyshacl + SPARQL          │
                                          │ tier      │   competency + ROBOT/HermiT │
                                          │ classify  │   (OWL consistency)         │
                                          │ (LLM)     │                             │
                                          └───────────┘                             │
                                                                                    │
  QUERY INTERFACE ◀───────────────────────────────────────────────────────────────┘
   • CLI: scripts/pld/query.py  (+ saved .rq files with parameter FILTERs)
   • Web: Next.js /api/sparql proxy → Fuseki  (app/)
   • Demo: Flask CORS proxy (serve_demo.py)

  DEPLOY: Dockerfile (Temurin JRE 21 + fuseki-server.jar + seed TTL baked in) → Railway
          start.sh seeds TDB2 only if empty; shiro.ini auth from FUSEKI_PASSWORD env var
```

---

## 3. The methodology it is built on (copy this — it is the real IP)

Everything is organised around a **6-stratum Knowledge-Organization-System (KOS)
pipeline**, each stratum anchored to a published standard. This is the part that makes
the output defensible rather than ad-hoc, and it maps cleanly onto a standards corpus.

| Stratum | Output | Standard | What it means for stadia-x |
|---|---|---|---|
| S1 | Controlled Vocabulary | ANSI/NISO Z39.19 | The canonical terms/enum values in your corpus |
| S2 | Metadata Standards | ISO 11179 | One datatype property per field you extract |
| S3 | Taxonomy | ISO 25964-1 | Broader/narrower hierarchy (e.g. document → section → clause) |
| S4 | Thesaurus (sweet spot) | ISO 25964-2 | Cross-references, exact-match links between instruments |
| S5 | Ontology (OWL) | W3C OWL 2 | Class axioms, relationships, inferred subclasses |
| S6 | Knowledge Graph | W3C RDF / SPARQL | The populated, queryable ABox |

**Hard build rule from the source repo: complete S1–S4 before writing any OWL (S5).**
"Introducing OWL constraints over messy vocabulary is the most common ontology-engineering
failure mode." For a standards corpus this discipline matters — do the vocabulary and
taxonomy first, formalise second.

Supporting doctrine (`Ontology_Doctrine_UseCase_First_v1.md`): **every class is a
liability**. Only add a concept if a real *competency question* cannot be answered without
it. Chain: `Use Case → Competency Questions → Data Product → Ontology`. Do not model
"beautiful hierarchies" that answer no question.

---

## 4. Identity policy (copy verbatim — it is what makes retrieval "precise")

Every entity gets a globally unique, dereferenceable, **versioned** URI:

```
https://{your-domain}/instances/{org}/{corpus}/{TypePrefix}-{local_id}@{version}
```

Real examples from the repo:

```
https://deixis.design/instances/gla/london-plan-2021/PolicyD3@v1
https://deixis.design/instances/gla/london-plan-2021/PolicyD3-a@v1     # sub-clause
https://deixis.design/instances/gla/london-plan-2021/Para2.1.3@v1      # paragraph
```

Every entity also carries **source anchoring** so you can jump to the exact spot in the
original PDF — this is the "golden thread" that makes paragraph-level precision real:

```turtle
puk:pdfPage 142 ;                              # printed page the practitioner cites
puk:pdfFilePage 157 ;                          # physical PDF page (page ≠ file page)
puk:dctSource "London_Plan_2021.pdf#page=157" ;# deep link into the PDF viewer
puk:extractionConfidence "verbatim" ;          # verbatim | failed
puk:extractedBy "extract_london_plan.py v0.3" ;
puk:extractionDate "2026-07-11"^^xsd:date ;
```

**Rule enforced in the repo:** the TBox (ontology) and ABox (instances) must be at the
same spec version before you mint new URIs. Version everything.

**Centralise URI minting in one module** (`scripts/_shared/uri.py` in the repo). It is the
single source of truth for the identity policy — small helpers like `app_uri(org, ref)`,
`decision_uri(app, step)`, all slugs lowercased with non-alphanumerics replaced by `-`.
Never build a URI by string-concatenation scattered across scripts; call the helper.

---

## 5. The pipeline, layer by layer, with the real files

### 5.0 Orchestration
`scripts/pipeline.py` chains the whole thing for one document ("instrument"). An
**instrument registry** dict declares, per document type: extractor script, extractor
args, classify flag, TTL generator, validator. Downstream steps are generic; only the
**extractor is document-specific**. Skip flags (`--skip-extract`, `--only-classify`, …)
let you re-run any stage.

```bash
uv run python scripts/pipeline.py --instrument london_plan --workers 8
uv run python scripts/pipeline.py --instrument london_plan --only-classify
```

### 5.1 Extract — PDF → structured JSONL  (Path A, LLM-based)
File: `scripts/extract_london_plan.py` (the pattern to copy).

Phases:
1. **PDF → text** with **PyMuPDF (`fitz`)**, one `<!-- PAGE n -->` marker per page so
   page numbers survive into the entities.
2. **Boundary detection** with regex — find where each policy/section starts. Neat trick:
   collect *all* candidate matches for a code and keep the **largest** span, which rejects
   table-of-contents entries and in-body cross-references in favour of the real section.
3. **LLM structured extraction** — for each detected section, call the Anthropic API
   (`claude-sonnet-4-5`, streaming, `max_tokens=32000`) with a prompt that returns one
   JSON object `{policy, subClauses, paragraphs}`. The extraction schema is stored as a
   fenced `<!-- prompt-section -->` block inside a markdown file and spliced into the
   prompt — **schema and prompt live together, versioned in git**.
4. **Assemble records** — mint URIs, compute printed-vs-physical page numbers, resolve
   cross-references to URIs, set provenance fields, write three JSONL files
   (`policies.jsonl`, `sub_clauses.jsonl`, `paragraphs.jsonl`).

Production-quality touches worth copying:
- **`ThreadPoolExecutor` with `--workers`** for parallel LLM calls.
- **Resume/idempotency** (`--resume`): reads which codes are already in the output JSONL
  and skips them; append vs overwrite is decided automatically.
- **`--no-llm`** debug pass that dumps detected boundaries only (cheap iteration).
- **`--reuse-text`** to skip the expensive PDF re-parse.
- Per-record flush so a crash never loses completed work.
- Failed JSON parses are written to `_failed_{code}.txt` instead of aborting the run.
- **"CRITICAL: verbatimText must be character-faithful. Do not paraphrase."** — the
  prompt forbids the LLM from rewriting source text. Essential for a standards corpus.

### 5.1b Extract — schema → TTL  (Path B, deterministic, no LLM)
File: `scripts/pld/01_lift_schema.py` (893 lines).

When your source is a *published technical schema* rather than prose PDFs, you skip the
LLM entirely and **lift deterministically**: enum lists → SKOS concepts, schema fields →
OWL datatype properties, dot-notation field nesting → SKOS broader/narrower taxonomy,
required fields → SHACL `sh:minCount`, closed lists → SHACL `sh:in`. The GLA PLD module
turned a 275-field schema into 7 classes + 312 SKOS concepts + 340 properties this way,
with PROV-O provenance on every file. **This path is more robust and cheaper than LLM
extraction — prefer it whenever the source has structure you can parse.**

### 5.2 Classify — optional semantic tagging  (LLM-based)
File: `scripts/classify_judgement_zones.py`.

A second LLM pass tags each clause into a domain taxonomy (here: a 5-tier
"Judgement Zones" scheme — hard threshold vs guidance vs interpretive vs judgement vs
out-of-scope). Two things here are genuinely enterprise-grade and transferable:

- **A calibration gate (`--gate2`)**: 20 hand-labelled ground-truth clauses are run first;
  the script computes accuracy and **exits non-zero unless it hits ≥ 95%**. You do not run
  the full corpus until the prompt passes the gate. This is how you keep an LLM
  classification step honest.
- **Compound splitting**: one clause can carry multiple tags, each with its own text
  fragment, rationale, and confidence score. Output is auditable, not just a label.

### 5.3 Generate RDF — JSONL → Turtle
File: `scripts/generate_london_plan_ttl.py`.

Reads the JSONL, emits `.ttl` (`06a_policies`, `06b_subclauses`, `06c_paragraphs`,
`06d_instrument`). Class is chosen by code prefix (`D`→DesignPolicy, `H`→HousingPolicy…).
**Note the technique honestly:** it builds Turtle by **hand with f-strings** and closes
each block with the `lines[-1][:-1] + "."` trick. It works, but see §7 — for stadia-x use
`rdflib.Graph` + `.serialize()` instead.

### 5.4 Generate SHACL — classified clauses → shapes
File: `scripts/generate_shacl.py`. Turns each tier into the right artefact: T1 →
`sh:NodeShape` with `sh:Violation`, T2 → `sh:Warning`, T3 → methodology-presence check,
T4/T5 → query templates (no SHACL). The mapping from *semantic tag* to *machine-checkable
constraint* is a strong pattern for a standards corpus (a "must ≥ X" standard becomes a
hard shape; a "should consider" becomes a warning).

### 5.5 Validate — twice
- **SPARQL competency checks**: `scripts/validate_london_plan.py` loads TBox+ABox into an
  in-memory `rdflib.Graph` and runs ~7 assertions ("policy count == 113", "URIs all
  conform to the pattern", "zero policies missing a code", "≥50 cross-reference links").
  Pass/fail with an exit code — CI-friendly.
- **SHACL** via **pyshacl**, and **OWL consistency** via **ROBOT** (`robot reason
  --reasoner HermiT`) using the bundled JDK 21 + `robot.jar` toolchain.

### 5.5b (Optional) Rich decision/event materialisation — the deictic layer
File: `scripts/pld/05_json_to_rdf.py`. The most semantically sophisticated script: it maps
extracted cases onto the upper ontology's "origo" tuple (agent / site / time / authority)
using **BFO/OBO** foundational IRIs (`obo:BFO_0000029` site, `BFO_0000008` temporal region,
etc.) and links each case to the policy URIs it cites. You do not need this for basic
paragraph retrieval, but it is the template if stadia-x must model *who decided what,
where, when, under which standard* as first-class events. (Note: this script hand-writes
Turtle strings — rewrite with rdflib if you adopt it.)

### 5.6 Load into the graph database
File: `scripts/pld/04_load_fuseki.py`.

**Load-bearing config values to reproduce** (from `04_load_fuseki.py` / `query.py` /
`railway/`): Fuseki base `http://localhost:3030`; dataset `deixon` (read) / `deixon-admin`
(write); endpoints `/{ds}/data` (Graph Store upload), `/{ds}/update` (`CLEAR ALL`, `INSERT`),
`/{ds}/sparql` (query), `/$/ping` (health); HTTP Basic auth user `fuseki`, password from
`FUSEKI_PASSWORD`. Endpoints are currently **hardcoded** in the CLI/demo scripts — make them
`--host`/env-driven when you copy them.

- Talks to Fuseki over the **SPARQL Graph Store Protocol**: `POST` `text/turtle` to
  `http://localhost:3030/deixon/data`.
- **`CLEAR ALL` first** to make loads idempotent (no blank-node accumulation on re-run).
- ABox TTL → default graph; TBox (extracted from ```turtle``` blocks inside markdown docs)
  → also default graph so cross-joins work. A named-graph variant
  (`?graph=https://…/graphs/tbox`) is available.
- **Inference is materialised by hand** via `INSERT { ?x a :Norm } WHERE { ?x a
  :DesignPolicy }` SPARQL UPDATEs, because Fuseki does not fire its reasoner on
  HTTP-uploaded data. Every subclass→superclass edge is listed explicitly. (Works, but
  brittle — see §7.)

---

## 6. The query interface

Three surfaces, all over the same SPARQL endpoint:

**a) CLI** — `scripts/pld/query.py`
```bash
uv run python scripts/pld/query.py --list                 # list saved queries
uv run python scripts/pld/query.py --query queries/q1_precedent.rq
uv run python scripts/pld/query.py --sparql "SELECT ?p WHERE { ?p a puk:LondonPlanPolicy } LIMIT 5"
```
`requests.post` to `/deixon/sparql`, `Accept: application/json`, prints an aligned table.
Standard prefixes are prepended automatically so queries stay short.

**b) Saved parameterised queries** — `ontology/modules/.../queries/*.rq`
Each `.rq` file is a documented competency question with a header explaining purpose,
parameters, and interpretation, and `FILTER(...)` lines you edit per run. This is a clean
way to ship a **query library** for non-SPARQL users. Copy this convention.

**c) Web app** — `app/` (Next.js)
- `app/app/api/sparql/route.ts`: a server route that injects standard prefixes + Basic
  auth and proxies the query to Fuseki (`FUSEKI_URL` env). Keeps the password server-side.
- `app/lib/sparql.ts`: a 15-line typed client (`query(sparql) → bindings[]`).
- Pages for London Plan, NPPF, Decisions render query results.

**d) Local demo proxy** — `scripts/pld/serve_demo.py`
A tiny Flask app that serves a static HTML page and proxies `/sparql` to Fuseki to sidestep
browser CORS. Useful for quick demos without standing up the Next.js app.

---

## 7. Deployment

`Dockerfile` + `railway/` deploy the triplestore as a single container:

- Base `eclipse-temurin:21-jre-jammy`; downloads **Fuseki 6.0.0** and keeps only
  `fuseki-server.jar`.
- **Seed TTL is baked into the image** (`COPY … /data/seed/…`).
- `railway/deixon.ttl` — Fuseki config declaring **two services on one TDB2 dataset**: a
  public read-only `sparql` service (`deixon`) and an internal read-write `deixon-admin`
  service (query+update+upload+graph-store). Clean separation of public read from
  privileged write.
- `railway/start.sh` — refuses to start without `FUSEKI_PASSWORD`; writes `shiro.ini` from
  the env var; starts Fuseki on TDB2; waits for `/$/ping`; **loads seed data only if the
  store is empty** (counts triples first); removes stale TDB2 locks left by a killed
  container. Auth (Apache Shiro) on all endpoints.

```bash
docker build -t stadia-x .
docker run -e FUSEKI_PASSWORD=secret -p 3030:3030 stadia-x
```

---

## 8. Tech stack summary (dependencies to reproduce)

| Concern | Choice in this repo | Notes |
|---|---|---|
| PDF text | **PyMuPDF** (`pymupdf`/`fitz`) | fast, good layout retention |
| LLM extraction/classification | **Anthropic** `claude-sonnet-4-x`, streaming | schema-in-prompt, JSON out |
| RDF authoring | **rdflib** (loading/validating); hand f-strings (generating) | replace generation with rdflib |
| SHACL validation | **pyshacl** | structural conformance |
| OWL reasoning | **ROBOT** (`robot.jar`) + **Temurin JDK 21**, HermiT | consistency, inference |
| Triplestore | **Apache Jena Fuseki 6.0.0** + **TDB2** | SPARQL 1.1, persistent |
| Query CLI/proxy | **requests**, **Flask** | |
| Web UI | **Next.js** (App Router) + server SPARQL proxy | |
| Deploy | **Docker** → **Railway**, Shiro auth | seed baked in |
| Package mgmt | **uv** (`pyproject.toml`, Python ≥ 3.13) | |

Python deps: `anthropic`, `pymupdf`, `rdflib`, `pyshacl`, `requests`, `flask`, `openpyxl`.

---

## 9. Judgement: enterprise-grade vs. works-here-but-improve

### 9a. Enterprise-grade — copy these verbatim
- **The 6-stratum, standards-anchored methodology** (Z39.19 / ISO 11179 / ISO 25964 /
  OWL 2 / RDF). This is the durable asset and it maps perfectly onto a standards corpus.
- **Dereferenceable, versioned URIs + source anchoring** (page/paragraph deep links,
  `extractionConfidence`, `extractedBy`, `extractionDate`). This is exactly what "query
  precisely certain paragraphs and standards" needs — the identity and provenance model is
  already right.
- **Dual validation** (SHACL structural + SPARQL competency + ROBOT OWL consistency), each
  with a CI-friendly exit code.
- **The LLM calibration gate** (`--gate2`, ≥95% before full run) and **verbatim-faithful**
  extraction constraint. This is how you use an LLM in a compliance context responsibly.
- **Idempotent, resumable, parallel extraction** with per-record flush and failure capture.
- **Public-read / internal-write endpoint separation**, auth from env, seed-only-if-empty.
- **Query library as documented `.rq` files** + a thin typed web proxy that keeps
  credentials server-side.
- **Auto-generated state/inventory** (`generate_state.py` → `STATE.md`) — machine-readable
  "what's actually built right now". Great governance habit for a growing corpus.

### 9b. Works here, but improve for a larger corpus
1. **Turtle generated by hand with f-strings** (`generate_*_ttl.py`). Fragile escaping, the
   `lines[-1][:-1] + "."` close-the-block trick, no round-trip guarantee. → Build an
   `rdflib.Graph` and call `.serialize(format="turtle")`. Eliminates a whole class of bugs.
2. **TBox hidden inside markdown ```turtle``` fences, extracted by regex.** Cute for
   doc/code co-location, but non-standard and easy to break. → Keep ontology in real `.ttl`
   files; generate docs *from* the ontology, not the reverse.
3. **Inference materialised by hand-listed SPARQL UPDATE `INSERT`s.** Every subclass edge is
   enumerated in Python; add a class and you must remember to add the INSERT. → Run a
   reasoner (ROBOT/HermiT, or a store with built-in RDFS/OWL-RL like GraphDB) at load time,
   or use `rdfs:subClassOf` + a store that honours it.
4. **Extraction is a bespoke Python script per document type** (`extract_london_plan.py`
   vs `extract_nppf.py`) with regex tuned to one PDF's quirks. For "tons of policy docs"
   this does not scale. → Generalise to a **layout-aware document parser** (e.g. a
   heading/section segmenter) + a single schema-driven LLM extraction step; reserve custom
   code for genuinely irregular sources.
5. **No text or vector search.** Retrieval is exact-match SPARQL `FILTER`. For "query
   precisely certain paragraphs" across a large corpus you need lexical + semantic search,
   not just structural queries. → Add full-text and/or embeddings (see §10). This is the
   single biggest functional gap for stadia-x.
6. **Fuseki/TDB2 single container, seed baked into the image, reseed logic in bash+curl+
   inline-python.** Fine for a read-mostly, moderate graph; not fine as the corpus grows or
   needs frequent updates. TDB2 is a single-writer embedded store with no HA. → Decouple
   data from image (volume or object storage), and consider a store with better ops (§10).
7. **Browser-issued raw SPARQL** through the proxy is an injection/DoS surface if the
   endpoint is public. → Whitelist/parameterise queries, add timeouts and result caps
   (the proxy already sets a 30s timeout; add `LIMIT` enforcement and query allow-listing).
8. **`.env` / `.env.local` present at repo root** — confirm they are git-ignored and hold no
   real keys before copying the pattern.
9. **Known dead-code to delete on copy** (harmless in this repo, confusing to inherit): a
   stale `shapes.ttl` path in `01_lift_schema.py`'s self-verify (actual output is
   `pld_shapes.ttl`); an unused `parse_date` v1 in `02_ingest_record.py`; an MRO-hack
   triple count in `03_validate.py` that is immediately overwritten by a clean SPARQL COUNT;
   `time.sleep(1)` commit waits in `04_load_fuseki.py` (pragmatic, but prefer polling).

---

## 10. Database recommendation for stadia-x

**Keep RDF + SPARQL as the model.** For policy documents and standards — where the value is
in *relationships* (this clause supersedes that one, this standard is cited by that policy,
this paragraph belongs to that section), *cross-references*, and *provenance chains* — a
graph/triplestore is the correct choice, not a relational schema. The repo also contains an
older **SQLite/relational** reference implementation (`aec_decisions_db.py`, IBIS/QOC
model); it is fine for a single-project decision log but does not give you the
cross-corpus, standards-traceable querying you want. Do not go relational for the main
store.

But make two upgrades over plain Fuseki/TDB2:

**Upgrade 1 — add retrieval that Fuseki doesn't give you.** "Query precisely certain
paragraphs" is a *hybrid* problem: structure (graph) + wording (lexical) + meaning
(semantic). Options, cheapest first:
- **Apache Jena + `jena-text` (Lucene) index** — keeps your existing Fuseki stack, adds
  full-text search over `verbatimText`. Lowest migration cost.
- **Add a vector store** (`pgvector`, Qdrant, or OpenSearch) holding paragraph embeddings,
  alongside the graph. Retrieve candidate paragraphs semantically, then use the graph for
  the structured relationships and provenance. This is the RAG-over-knowledge-graph pattern
  and is the natural fit for stadia-x.

**Upgrade 2 — choose the triplestore for the scale and ops you actually need:**

| Store | When to pick it |
|---|---|
| **Fuseki + jena-text** | Staying close to the current stack; moderate corpus; you want full-text without new infra. Good default to start. |
| **Oxigraph** | Single fast embedded SPARQL store (Rust), simple ops, good for read-heavy service. |
| **GraphDB (Ontotext)** | Enterprise: built-in OWL/RDFS reasoning **and** full-text **and** semantic similarity in one engine. Removes upgrades 1 *and* the hand-materialised inference (§9b.3). Strongest "just works" option for a standards graph. |
| **Stardog** | Enterprise: reasoning + search + virtual graphs (query external data in place). |
| **AWS Neptune** | Managed, scalable, HA; less reasoning; good if you want zero-ops at scale. |

**Simplest single-store alternative worth serious consideration:**
**PostgreSQL + Apache AGE (openCypher graph) + `pgvector` (embeddings) + `tsvector`
(full-text)** — one database that gives you graph traversal, semantic search, and lexical
search with one set of backups, one set of credentials, and far simpler ops than
Fuseki + Lucene + a vector DB. You lose native SPARQL/OWL (you'd query in Cypher/SQL and do
reasoning in application code), but for a new build that prizes few moving parts and strong
paragraph-level retrieval, this is the pragmatic choice. **Regardless of store, keep Turtle
(`.ttl`) as your portable interchange format** so you are never locked in.

**My recommendation for stadia-x:** start with **Fuseki + jena-text** to reuse this repo's
pipeline unchanged and validate the model, add a **pgvector/Qdrant embedding index** for
semantic paragraph retrieval, and if reasoning + search + ops become painful, migrate the
triplestore to **GraphDB** (it subsumes the full-text index and the hand-rolled inference).
If you would rather not run three services, go **Postgres + AGE + pgvector + tsvector** from
day one.

---

## 11. Minimum file set to copy / adapt into stadia-x

```
scripts/
  pipeline.py                       # orchestrator + instrument registry  (adapt registry)
  extract_<doc>.py                  # PDF→JSONL  (copy extract_london_plan.py as template)
  classify_<scheme>.py              # optional LLM tagging + calibration gate (copy pattern)
  generate_<doc>_ttl.py             # JSONL→TTL  (REWRITE with rdflib, don't copy f-strings)
  generate_shacl.py                 # tag→shape mapping (copy pattern)
  validate_<doc>.py                 # SPARQL competency checks (copy pattern)
  pld/04_load_fuseki.py             # TTL→Fuseki via Graph Store Protocol (copy)
  pld/query.py                      # CLI query runner (copy)
  pld/serve_demo.py                 # Flask CORS proxy (copy)
ontology/
  spec/<upper>.ttl                  # your upper ontology / narrow-waist classes
  modules/<corpus>/01..05 + 06*.ttl # the 6-strata build, per corpus
  <corpus>/queries/*.rq             # documented parameterised query library (copy convention)
app/                                # Next.js SPARQL UI (optional; copy /api/sparql proxy)
railway/  deixon.ttl start.sh shiro.ini
Dockerfile                          # Temurin JRE 21 + Fuseki + seed  (copy, swap seed paths)
pyproject.toml                      # anthropic, pymupdf, rdflib, pyshacl, requests, flask
CLAUDE.md / STATE.md pattern        # session-start rules + auto-generated build inventory
```

**Build order for stadia-x:** (1) pick 2–3 representative source docs and one competency
question each; (2) S1–S4 vocabulary/taxonomy/thesaurus by hand or by schema-lift; (3)
extraction script → JSONL with verbatim text + page anchors; (4) rdflib TTL generation;
(5) SHACL + SPARQL validation; (6) load Fuseki + add jena-text/vector index; (7) query
library + web proxy; (8) Dockerise. Do not write OWL (S5) until S1–S4 are clean.
```
