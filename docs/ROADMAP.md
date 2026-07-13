# Stadia-X Product Roadmap / PRD

The product-feature layer on top of `docs/PLAN.md` (which covers the ingestion/query
pipeline). This document is the backlog: each feature is a candidate GitHub issue with
a scope and acceptance criteria. Track status with the checkboxes.

**Priority:** P0 (now) - P1 (next) - P2 (enterprise-readiness) - P3 (later).
**Effort:** S (< 1 day) - M (a few days) - L (1-2+ weeks).

---

## Current state (shipped)

- Extraction pipeline: PDF -> PyMuPDF parse -> Claude structured extraction (verbatim, overlap+dedup) -> JSONL.
- Single Postgres store on Neon: clauses (pgvector + tsvector), anticipated-questions index, terms, refs.
- Voyage embeddings (`voyage-3.5`, 1024-dim) at load and query time.
- Cloudflare R2 for source PDFs + title-page thumbnails; PDFs served to the app via same-origin proxy.
- Hybrid search (semantic clause + semantic questions + full-text, fused with RRF) with a transparent
  Semantic / Keyword / Combined score breakdown.
- Studio (Next.js on Vercel): Search, Standards (clickable -> viewer, hover thumbnail), Defined terms,
  Review (clause list beside react-pdf viewer with page jump), all reading live from Neon/R2.
- Document-level supersession: editions marked Current / Superseded, "Replaced by" links, Superseded tags.
- Live at stadia-x.vercel.app.

---

## P0 - Ask: answers, not just results  (Effort: M)

**What:** A Q&A mode. User asks a natural-language question; the app retrieves the top clauses and
Claude writes a short answer grounded ONLY in those clauses, with every claim citing the exact clause +
page and a jump-to-source link.

**Why:** Turns a search engine into a compliance assistant - the single biggest jump in perceived value.
Feasible now: retrieval + Anthropic already in place.

**Scope:**
- New API route `/api/ask`: run hybrid search -> pass top-k clauses to Claude with a strict
  "answer only from these, cite clause ids" prompt -> return answer + the cited clauses.
- New "Ask" tab; render the answer with inline citation chips that scroll/link to the cited clause + PDF page.
- Guardrail: if nothing relevant is retrieved, say so rather than inventing an answer.

**Acceptance criteria:**
- [ ] Answer cites at least one real clause id for every factual sentence.
- [ ] Each citation links to the clause and opens the source PDF at the right page.
- [ ] "No sufficient basis in the corpus" response when retrieval is weak (no hallucinated rules).
- [ ] Superseded clauses are flagged in the answer or excluded by default.

---

## P1 - Everyday UX

### Search filters / facets  (Effort: S)
**What:** Filter results by obligation (shall/should/may/informative), status (current/superseded),
publisher, and standard.
**Why:** #1 daily compliance need ("only binding, current requirements"). All fields already on each clause.
- [ ] Facet controls on the Search tab (multi-select).
- [ ] Filters apply server-side in the search query, not just client hiding.
- [ ] "Current only" default toggle.

### Clause detail pages + cross-reference links  (Effort: M)
**What:** Permalink page per clause: full text, obligation, provenance, defined terms, anticipated
questions, neighbouring clauses, and references rendered as clickable links.
**Why:** Traceability enterprises demand; makes the reference graph navigable (refs are stored but inert today).
- [ ] Route `/clause/[id]` with full clause detail.
- [ ] References resolve to linked standards/clauses where identifiable.
- [ ] Deep-links from search results and the review tab.

### Current-over-superseded ranking  (Effort: S)
**What:** Rank current-edition clauses above superseded ones (status already wired).
- [ ] Superseded clauses de-ranked (not hidden) in default search.

### Synonym / acronym expansion  (Effort: S-M)
**What:** Domain synonym file (FoP = field of play, run-off = clear space, publisher acronyms) applied at
query time to improve recall. (Planned in PLAN.md 6.1, not yet wired.)
- [ ] `shared/query_synonyms` file; query expanded before search.

---

## P2 - Enterprise readiness

### Auth + accounts (SSO)  (Effort: M)
**What:** Login with Google/Microsoft SSO; user accounts. Prerequisite for private corpora, collections,
audit, and any real rollout (site is currently fully public).
- [ ] SSO login; unauthenticated users gated from private areas.
- [ ] Per-user identity available to collections/audit.

### Admin "Add a standard" flow  (Effort: L)
**What:** Browser upload -> auto-extract -> review/approve -> publish, replacing the CLI. The Review tab is
already the approval step.
- [ ] Upload a PDF in the app; extraction runs (queued/background).
- [ ] Extracted clauses land in a "pending review" state; approve to publish to search.
- [ ] Set title/publisher/supersedes in the UI.

### Collections / projects + notes  (Effort: M)
**What:** Save clauses into named sets ("Project X - pitch compliance"); add notes. The "Saved" tab made real.
- [ ] Create/rename/delete collections; add/remove clauses.
- [ ] Per-clause notes, scoped to the user/collection.

### Export to compliance report  (Effort: M)
**What:** Select clauses (or a collection) -> generate a cited PDF/Word report.
- [ ] Export a collection to a formatted document with clause text + citations + source pages.

### Audit log  (Effort: S-M)
**What:** Record who searched / added / approved / exported what.
- [ ] Append-only log of key actions with user + timestamp.

### Shareable links  (Effort: S)
- [ ] Share a search or a clause via URL (respecting auth).

---

## P3 - Power features

### Edition comparison (clause-level diff)  (Effort: L)
**What:** Side-by-side "what changed between edition A and B", matching clauses across editions.
This is clause-level version tracing (document-level supersession already shipped).
- [ ] Match clauses across two editions of the same standard.
- [ ] Show added / removed / changed clauses with a text diff.

### Cross-standard comparison  (Effort: L)
**What:** Compare how different standards (FIFA vs AFC vs UEFA) treat the same topic.

### Coverage / gap analysis  (Effort: L)
**What:** Given a set of project topics, show which have no governing clause.

### OCR for scanned PDFs  (Effort: M)
**What:** Handle the scanned/image PDFs currently filtered out (e.g. Azure Document Intelligence),
so the full corpus is ingestible.

---

## Menu / information architecture evolution

Everyday tabs: **Ask - Search - Standards - Terms - Collections**.
Move **Review** and the new **Add-a-standard** under an **Admin** area (behind auth).
"Saved" becomes "Collections".

---

## Non-goals (for now)

- Formal OWL reasoning / SPARQL endpoint (Turtle export remains the escape hatch; see PLAN.md 5).
- Public/anonymous write access.
- Real-time multi-user editing.

## Open questions

- Which SSO provider(s) do the target users have (Google Workspace, Microsoft Entra)?
- Should superseded clauses be hidden by default or shown-but-tagged? (currently shown + tagged)
- Report export format priority: PDF, Word, or both?
- Corpus scale target: how many standards/documents in the first enterprise deployment?
