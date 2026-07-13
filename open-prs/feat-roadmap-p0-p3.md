# PR: Ship P0 Ask + P1–P3 roadmap features

- **Branch (head):** `feat/roadmap-p0-p3`
- **Base:** `main`
- **Open it:** https://github.com/rlindemann/stadia-x/pull/new/feat/roadmap-p0-p3
- **Status:** branch pushed; PR not yet opened (available token lacks pull-request write permission).

---

Implements the P0 Ask feature plus the P1–P3 roadmap backlog, closing all open issues except SSO (#6) and audit log (#10), which are deferred pending an auth decision.

## Shipped (verified against the live DB)

**P0 / P1**
- **Ask** (#1): `/api/ask` grounds a Claude answer only in retrieved clauses, with `[[clause_id]]` citation chips to clause + PDF page, a "no sufficient basis" guardrail, and superseded flagging.
- **Search facets** (#2): server-side obligation/status/publisher/standard filters + "current only" default toggle.
- **Superseded de-ranking** (#4): superseded clauses ranked lower, not hidden.
- **Synonym/acronym expansion** (#5): domain synonyms applied to the lexical query.
- **Clause detail pages** (#3): `/clause/[id]` with resolved references, defined terms, questions, neighbours; deep-links from search.

**Analysis (new `Analyze` hub)**
- **Edition diff** (#12): clause matching by number + inline word-diff.
- **Cross-standard comparison** (#13): per-standard positions and differences, cited.
- **Coverage / gap analysis** (#14): flags project topics with no governing clause.

**P2**
- **Collections + notes** (#8): localStorage-backed (auth deferred); Save buttons on results and clause pages; `Saved` → `Collections`.
- **Shareable links** (#11): search reflects query + filters in the URL; Copy-link on search and clause pages.
- **Export** (#9): a collection → cited **PDF** and **Word** report.
- **Admin add-a-standard** (#7): upload → pending review → publish; review gating via `standards.meta` (no schema migration); public search hides pending. Extraction runs on a self-hosted server (`LOCAL_INGEST=1`), else the CLI command is surfaced.
- **OCR** (#15): scanned-page detection + pluggable Tesseract/Azure, opt-in via `--ocr`.

## Deferred
- **SSO (#6)** and **audit log (#10)** — both need real user identity.

## Activation notes
- **#7 extraction** can't run in a Vercel request (no Python). Set `LOCAL_INGEST=1` on a self-hosted host with `uv`, or run a worker/queue.
- **#15 OCR** needs Tesseract installed or `AZURE_DI_ENDPOINT`/`AZURE_DI_KEY`.

Typechecks clean and the production build is green. 36 files, +3148/−79.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
