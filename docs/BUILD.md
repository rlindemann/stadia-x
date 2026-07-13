# BUILD.md - Resume here (canonical project state)

The single source of truth for **what we built, what we decided, where we are, and what's next.**
Update this file whenever we finish something material. To resume: read this, then `CLAUDE.md`,
`docs/PLAN.md` (pipeline), `docs/ROADMAP.md` (feature backlog), and the notes in `assessments/`.

Working style: the user is **not deeply technical** - explain in plain English, define jargon,
and justify recommendations with trade-offs rather than asserting.

Last updated: after building the GraphRAG layer and ingesting the AFC 24051 edition.

---

## What Stadia-X is
Ingest policy/standards PDFs, extract them into structured clauses with clause-level provenance,
and query precisely by meaning, wording, the questions each clause answers, **and now the links
between clauses**. Live product at **stadia-x.vercel.app**.

## Two lineages (important context)
Stadia-X was distilled from two prior projects, kept in the repo:
- **`stadia_x_starter`** = the retrieval cores of **KYRA** (a podcast Q&A project) - the
  **retrieval-first / RAG** approach. This is the lineage the live `studio/` app grew from.
- **`stadia_core`** = the generalized rewrite of **DeixOn** - the **semantic-web / knowledge-graph**
  approach (RDF, Fuseki triplestore, SPARQL, OWL reasoning, SHACL). **Parked for now** by decision;
  revisit "later". Nothing in the live app talks to it.

`docs/PLAN.md` reconciles the two; the shipped product is the RAG lineage plus a **Postgres-native
graph layer** (below) - deliberately *not* the RDF/Fuseki stack yet.

---

## Where we are now (all shipped + verified against live Neon/R2)

**Ingestion**
- PDF -> PyMuPDF -> Claude structured extraction (verbatim, overlap+dedup) -> JSONL -> load.
- Extraction is **parallel + self-healing**: independent page-windows run concurrently
  (`asyncio` + `AsyncAnthropic`, `CONCURRENCY=6`); a window whose JSON overflows `max_tokens`
  **auto-splits in half and retries** down to 1 page (no crash on dense pages). `--chunk-pages`
  overrides the default 4. ~13 min -> ~1-2 min on a 19-page doc.
- OCR hook for scanned pages: `ingest/ocr.py`, opt-in `--ocr` (Tesseract or Azure). Not active
  (no Tesseract installed / no Azure creds).

**Store** - Neon Postgres (pgvector + tsvector): `standards`, `clauses`, `clause_questions`
(hypothetical-questions index), `terms`, `refs`, and **`clause_edges`** (the graph).
Embeddings: Voyage `voyage-3.5`, 1024-dim. PDFs/thumbnails on Cloudflare R2 (bucket `stadia-x`).

**Corpus loaded (3 AFC editions, 701 clauses):**
- AFC Stadium Regulations 2021 (213), 2026 (330, supersedes 2021), **24051 (158, published)**.
- GraphRAG edges: **5,921** total.

**App (`studio/`, Next.js 16 on Vercel).** Nav: **Ask - Search - Standards - Analyze - Defined
terms - Collections - Review - Admin**.
- **Ask (P0)** - grounded, cited answers (`[[clause_id]]` chips -> clause + PDF page); no-basis
  guardrail; superseded flagged. **Now GraphRAG-expanded** (see below).
- **Search** - hybrid (semantic clause + semantic questions + full-text, RRF) with server-side
  **facets** (obligation/status/publisher/standard + current-only), **synonym expansion**,
  **superseded de-ranking**, and shareable **URL state + Copy link**.
- **Clause pages** (`/clause/[id]`) - full detail, resolved refs, defined terms, neighbours, and a
  **"Related via graph"** section (typed 1-hop neighbours).
- **Analyze** hub - **Edition diff** (clause-level word-diff), **Cross-standard comparison**,
  **Coverage / gap analysis**.
- **Collections** - localStorage-backed named sets + notes; Save buttons on results/clauses;
  **Export to PDF + Word** (cited reports).
- **Admin** - upload a PDF -> pending review -> publish; public search hides pending via
  `standards.meta.review_status` (no migration). Extraction runs when `LOCAL_INGEST=1` on a
  self-hosted host, else the CLI command is surfaced.

**GraphRAG (Postgres-native, no triplestore)**
- `clause_edges(src, dst, edge_type, weight)` - a typed clause graph, rebuilt by
  `ingest/build_graph.py` (**now auto-run at the end of `ingest/load.py`**).
- Edge types: `reference` (resolved "see clause X", also backfills `refs.to_clause`),
  `supersedes` (same clause across editions), `defines_term` (clause -> the clause defining a term
  it uses), `similar` (semantic k-NN). Current counts: similar 4206, defines_term 1412,
  supersedes 284, reference 19.
- Traversal = **recursive CTEs** (`getClauseGraph`, `graphExpand` in `studio/src/lib/db.ts`).
  Verified multi-hop: from clause 30.2 -> 7 clauses at 1 hop, 38 at 2 hops.
- Ask hops **one step** from retrieved seeds by default (`hop:true`) to pull in referenced/defining/
  superseding/similar clauses; graph-reached citations show a "graph - ..." badge.

---

## Key decisions & discussions (so we don't relitigate)
- **Auth deferred.** No login yet. SSO (#6) and audit log (#10) are **not built** - both need real
  user identity. Collections are therefore **per-browser (localStorage)**, and shareable links are
  URL-only (site is public).
- **Export = both PDF and Word** (resolved open question).
- **GraphRAG runs on Postgres, not Fuseki** (user decision: "not Fuseki for now, later yes").
  Recursive CTEs on Neon cover bounded multi-hop; **Neon cannot run Apache AGE**, and we don't need
  it. Neo4j only if the graph ever outgrows CTEs (nowhere near).
- **The graph is sparse on *explicit* references.** Only 19/180 refs resolve to a clause;
  **78% (141) point to external documents not in the corpus** ("AFC Statutes", "Competition
  Regulations", "Laws of the Game", "FIFA Quality Programme for Football Turf", "AFC Safety and
  Security Regulations"). We densified with `similar`/`defines_term`/`supersedes` edges so it always
  hops, but **the real lever to enrich the reference graph is loading the referenced documents.**
- **Full Microsoft-style GraphRAG (LLM entity extraction + community detection) is the wrong tool
  here.** A standards corpus has *explicit* structure (numbered clauses, cross-refs, terms,
  editions) already modelled as tables - no entities to discover. See `assessments/`.

---

## Stack / architecture facts a fresh session needs
- Query-time embedding is a Voyage **API call** (search runs in Vercel serverless) - do NOT
  reintroduce a local embedding model.
- PDFs stream through `/api/documents/[id]/pdf` (same-origin proxy from R2) - so **no R2 CORS**.
- react-pdf must be client-only (`next/dynamic`, `ssr:false`) or SSR crashes (`DOMMatrix`).
- Neon client is lazy (`studio/src/lib/db.ts`) - build never needs `DATABASE_URL`.
- `studio/AGENTS.md`: the Next.js is a modified/future version - the repo's own code is the source
  of truth for conventions (params are Promises, etc.).
- The Anthropic SDK **refuses non-streaming requests with large `max_tokens`** (>~16k) - that's why
  extraction keeps `MAX_TOKENS=16000` and splits windows instead of raising the cap.
- Public surfaces filter `coalesce(standards.meta->>'review_status','published') <> 'pending'`
  (`PUBLISHED` const in `db.ts`). Missing flag = published, so the existing corpus is unaffected.

---

## Setup on a new machine
Prereqs: `git`, `uv` (Python), `node`.
1. `git clone https://github.com/rlindemann/stadia-x.git && cd stadia-x`
2. Secrets (gitignored - bring from the other machine/provider dashboards):
   - Root `.env` from `.env.example`: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `DATABASE_URL` (Neon),
     `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=stadia-x`, `R2_PUBLIC_BASE`.
   - `studio/.env.local`: `DATABASE_URL` + `VOYAGE_API_KEY` (app-only work needs just these two).
3. `cd studio && npm install && npm run dev` -> http://localhost:3000
4. Python deps auto-install via `uv run`.

## Key commands
- Init schema (idempotent): `uv run python -m ingest.init_db`
- Extract: `uv run python -m ingest.extract "<pdf>" <ID> --title "<Title>" [--chunk-pages N] [--ocr]`
- Load (+auto graph rebuild + R2): `uv run python -m ingest.load data/out/<id>.jsonl <ID> --title "<Title>" --publisher "<Pub>" --pdf "<pdf>" [--supersedes <OLDER_ID>]`
- Rebuild graph only: `uv run python -m ingest.build_graph`
- Build app: `cd studio && npx next build`
- Windows: prefix non-ASCII Python prints with `PYTHONUNBUFFERED=1` (and run `python -u`).
- Windows gotcha: **kill stray `node.exe` before `git checkout`/`merge`** - a running `next start`
  locks `studio/src/app/*` dirs and blocks git with "Permission denied".

## Repo map
- `shared/models.py` - Clause contract (Pydantic).
- `ingest/` - `extract.py` (parallel+adaptive), `load.py` (+auto graph build), `build_graph.py`,
  `ocr.py`, `init_db.py`, `storage.py` (R2).
- `db/schema.sql` - Postgres schema (incl. `clause_edges`).
- `studio/` - Next.js app. Key: `src/lib/db.ts` (all queries + Voyage + graph),
  `src/app/api/*` (ask, search, facets, editions, cross-standard, gap, export, admin/*, documents/*),
  `src/app/{ask,clause,analyze,compare,cross,gaps,collections,admin,standards,terms,review}/`,
  `src/lib/{synonyms,collections,ingest,word-diff}.ts`, `src/components/{save-button,copy-link,cited-text}.tsx`.
- `stadia_core/` - DeixOn RDF/SPARQL lineage (**parked**). `stadia_x_starter/` - KYRA RAG cores.
- `assessments/` - `hybrid_graph_rag_architecture.md` (primer), `reference_graph_traversal_design.md`
  (the Postgres graph design).
- `docs/` - `PLAN.md`, `ROADMAP.md`, this file.

---

## What's next (open items, roughly prioritised)

1. **Densify the reference graph = load the referenced documents.** The single highest-leverage
   move: ingest AFC Statutes, Competition Regulations, Laws of the Game, FIFA turf programme, AFC
   Safety & Security Regulations. Then the 141 external refs start resolving into real edges and
   GraphRAG gets materially better. (Some are on disk under `data/OneDrive_.../`.)
2. **Improve ref resolution.** Some internal refs (e.g. sub-clauses "17.1.1") don't resolve because
   those clauses weren't extracted as separate rows - revisit extraction granularity or resolver.
3. **A/B graph-expanded Ask** vs plain hybrid on a question set; tune `SIMILAR_K`/`SIMILAR_MIN`.
4. **Auth track (deferred).** Pick SSO provider (Google/Microsoft) -> then per-user Collections,
   Audit log (#10), and auth-gated sharing. Blocked on a provider decision + OAuth creds.
5. **Admin extraction on Vercel.** Today extraction only runs with `LOCAL_INGEST=1` (self-hosted).
   Production needs a worker/queue.
6. **PR/branch housekeeping.** `feat/roadmap-p0-p3` is merged to `main`; the branch can be deleted.
   No open GitHub PR (the local token lacks pull-request-write scope).
7. **`stadia_core` (RDF/Fuseki/SPARQL) - "later".** The semantic-web lineage; revisit if/when a
   true triplestore + SPARQL + OWL reasoning is wanted alongside (or instead of) the Postgres graph.
8. **OCR activation** if scanned PDFs must be ingested (install Tesseract or wire Azure creds).
