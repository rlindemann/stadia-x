# Competency questions — what the system MUST be able to answer

These are not eval pairs. An **approved Q-A pair** (`pairs.json`) tests "did we get this
one fact right?" — it has a verified answer and is graded pass/fail by `run.mjs`.
A **competency question** tests "can the model even *express* this kind of answer at
all?" — it defines what the data model must support. Many below are **not answerable
today**; that is the point. Each unanswerable one names the modeling work it demands.

Status: `[OK]` answerable now · `[PARTIAL]` works but shallow/manual · `[GAP]` needs modeling.

| # | Competency question | Status | What it needs |
|---|---|---|---|
| 1 | What must a stadium contain to host a **Category A** match? | `[OK]` | **built** — `clause_applicability` + the `/categories` page (`ingest/applies_to.py` parses the ✓/△ matrices into `APPLIES_TO(requirement → category, modality, value)` rows) |
| 2 | How many VVIP seats does a **Category B** stadium need? | `[PARTIAL]` | covered when the requirement sits in a per-category matrix (now structured); a few numeric tables outside the matrices still read as prose |
| 3 | Generate a full compliance checklist for a stadium targeting a given category. | `[OK]` | **built** — `/categories` groups mandatory vs best-practice per category with the per-category value and a link to each clause |
| 4 | Which control-room requirements **changed** between the 2021, 2026 and 24051 editions? | `[PARTIAL]` | supersedes + edition diff exist, but the 2026 rename (Control Room → Venue Operation Centre) needs a `SAME_AS` link, not just the query-time synonym |
| 5 | Which documents does the corpus **reference but not contain**? | `[PARTIAL]` | `refs` holds 141 unresolved external refs; answerable as a report but not surfaced anywhere |
| 6 | What is the definition of "Stadium", and which clauses rely on it? | `[OK]` | terms + `defines_term` edges + clause page |
| 7 | What must a stadium control room contain? | `[OK]` | verified by `pairs.json` #1 |
| 8 | What medical and doping facilities must a stadium provide? | `[OK]` | Ask / hybrid search |
| 9 | List every mandatory (**shall**) requirement for spectator safety. | `[PARTIAL]` | obligation-type facet + topic search; no true "all requirements in scope X" aggregate |
| 10 | Which clauses are informative vs normative? | `[OK]` | `normativity` field |

**The signal (resolved):** rows 1-3 all pointed at the same missing element — `APPLIES_TO(category)`. That has now been **built**: `ingest/applies_to.py` parses the compliance matrices into `clause_applicability` (285 cells, 53 requirements across Categories A-E for the 2026 edition), surfaced on `/categories`. This is competency questions doing their job — they named the one modeling investment, and it unlocked the core compliance question.

**Next:** the `[OK]` rows can be promoted into `pairs.json` as graded regression pairs; the remaining `[PARTIAL]` rows are the roadmap (edition-diff `SAME_AS`, numeric tables outside matrices, cross-standard aggregates).
