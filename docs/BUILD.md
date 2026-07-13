# BUILD.md - Resume here

Continuation point for building Stadia-X on a fresh machine / new session.
To resume: tell the assistant **"pick up the build in docs/BUILD.md"**. It should read this
file, then `CLAUDE.md`, `docs/PLAN.md` (pipeline), and `docs/ROADMAP.md` (feature backlog),
then start the Next task below.

Working style: the user is not deeply technical - explain in plain English, define any jargon,
and justify recommendations with trade-offs rather than asserting.

---

## What Stadia-X is
Ingest policy/standards PDFs, extract them into structured clauses with clause-level provenance,
and query precisely by meaning, wording, and the questions each clause answers. Live product,
not a prototype. Deployed at **stadia-x.vercel.app**.

## Current state (shipped + deployed)
- Extraction: PDF -> PyMuPDF -> Claude structured extraction (verbatim, overlap+dedup) -> JSONL.
- Store: Neon Postgres (pgvector + tsvector): `clauses`, `clause_questions` (Hypothetical Questions
  index), `terms`, `refs`, `standards`.
- Embeddings: Voyage `voyage-3.5`, 1024-dim, at load and query time.
- Storage: Cloudflare R2 (bucket `stadia-x`) for source PDFs + title-page thumbnails.
- App: Next.js 16 in `studio/` on Vercel. Tabs: Search, Standards, Defined terms, Review, Saved.
- Search: hybrid (semantic clause + semantic questions + full-text) fused with RRF, with a
  transparent Semantic / Keyword / Combined score breakdown.
- Review tab: clause list beside a react-pdf viewer (page-jump box + arrows); PDF served via a
  same-origin proxy from R2.
- Standards: clickable rows -> open in Review viewer; hover -> title-page thumbnail.
- Document-level supersession: editions marked Current/Superseded, "Replaced by" links, Superseded tags.
- Corpus loaded: AFC Stadium Regulations 2021 (213 clauses) and 2026 (330 clauses), 2026 supersedes 2021.

## Stack / architecture facts a fresh session needs
- Query-time embedding is an API call (Voyage) so search runs inside Vercel serverless - do NOT
  reintroduce a local embedding model.
- PDFs load through `/api/documents/[id]/pdf` (streams from R2 same-origin) - so NO R2 CORS is needed.
- react-pdf must be loaded client-only (`next/dynamic`, `ssr:false`) or SSR crashes (`DOMMatrix`).
- Neon client is lazy (`studio/src/lib/db.ts`) so the build never needs DATABASE_URL at build time.
- Vercel needs only `DATABASE_URL` + `VOYAGE_API_KEY` env vars (R2 keys are load-time/local only).

## Setup on a new machine
Prereqs: `git`, `uv` (Python), `node`.

1. `git clone https://github.com/rlindemann/stadia-x.git && cd stadia-x`
2. **Secrets (gitignored - bring them from the other machine or the provider dashboards):**
   - Root `.env` - copy `.env.example`, fill in: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`,
     `DATABASE_URL` (Neon), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
     `R2_BUCKET=stadia-x`, `R2_PUBLIC_BASE`.
   - `studio/.env.local` - just `DATABASE_URL` and `VOYAGE_API_KEY`.
   - To work on the **app only** (e.g. the Next task), you just need `DATABASE_URL` +
     `VOYAGE_API_KEY` - the data already lives in Neon/R2. R2 keys + the `data/` PDFs (gitignored,
     NOT on GitHub) are only needed to ingest NEW documents.
3. Studio deps: `cd studio && npm install`
4. Run the app: `cd studio && npm run dev` -> http://localhost:3000
5. Python side auto-installs deps via `uv run` (from `pyproject.toml`).

## Key commands
- Init DB schema (idempotent): `uv run python -m ingest.init_db`
- Extract a PDF: `uv run python -m ingest.extract "<pdf>" <STANDARD_ID> --title "<Title>"`
- Load into Neon + R2: `uv run python -m ingest.load data/out/<id>.jsonl <STANDARD_ID> --title "<Title>" --publisher "<Pub>" --pdf "<pdf>" [--supersedes <OLDER_ID>]`
- Build the app: `cd studio && npx next build`
- On Windows, prefix Python that prints non-ASCII with `PYTHONIOENCODING=utf-8 PYTHONUTF8=1`.

## Repo map
- `shared/models.py` - the Clause contract (Pydantic).
- `ingest/` - `extract.py`, `load.py`, `init_db.py`, `storage.py` (R2).
- `db/schema.sql` - Postgres schema.
- `studio/` - Next.js app. Key files: `src/lib/db.ts` (all DB queries + Voyage embed),
  `src/app/api/*` (search, documents, documents/[id]/clauses, documents/[id]/pdf),
  `src/components/search-view.tsx`, `src/app/{standards,terms,review}/`.
- `docs/` - `PLAN.md` (pipeline plan), `ROADMAP.md` (feature backlog/PRD), this file.

---

## NEXT TASK: P0 - "Ask" (Q&A with citations)

Build the top item in `docs/ROADMAP.md`. Turns search results into a grounded answer.

**Do:**
1. `studio/src/app/api/ask/route.ts` - run `hybridSearch` on the question, take the top ~8 clauses,
   send them to Claude (`claude-opus-4-8`; read the `claude-api` skill first) with a strict prompt:
   answer ONLY from the provided clauses, cite clause ids inline, say so if there's no basis.
   Return the answer plus the cited clause records.
2. New **Ask** tab (add to header nav): question box -> renders the answer with inline citation chips
   that link to the clause and open the source PDF at the right page.
3. Guardrail: no hallucinated rules; flag or exclude superseded clauses.

**Acceptance criteria:** see `docs/ROADMAP.md` -> P0. Build, run `npx next build`, verify locally
against the live Neon data, then commit + push.

After P0, continue down `docs/ROADMAP.md` (P1: search filters, clause detail pages, ...).

**Open questions worth confirming with the user before large P2 items:** SSO provider (Google/Microsoft),
hide-vs-tag superseded clauses, report export format, target corpus size.
