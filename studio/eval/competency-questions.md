# Competency questions — what the system MUST be able to answer

These are not eval pairs. An **approved Q-A pair** (`pairs.json`) tests "did we get this
one fact right?" — it has a verified answer and is graded pass/fail by `run.mjs`.
A **competency question** tests "can the model even *express* this kind of answer at
all?" — it defines what the data model must support. Many below are **not answerable
today**; that is the point. Each unanswerable one names the modeling work it demands.

Status: `[OK]` answerable now · `[PARTIAL]` works but shallow/manual · `[GAP]` needs modeling.

| # | Competency question | Status | What it needs |
|---|---|---|---|
| 1 | What must a stadium contain to host a **Category A** match? | `[GAP]` | `APPLIES_TO(clause → category)` edges from the ✓/△/✗ matrices (currently free text in `clause_figures.transcription`) |
| 2 | How many VVIP seats does a **Category B** stadium need? | `[GAP]` | APPLIES_TO + the per-category numeric table extracted as structured cells, not a figure caption |
| 3 | Generate a full compliance checklist for a stadium targeting a given category. | `[GAP]` | APPLIES_TO + roll-up (the "compliance/metric tree" over categories) |
| 4 | Which control-room requirements **changed** between the 2021, 2026 and 24051 editions? | `[PARTIAL]` | supersedes + edition diff exist, but the 2026 rename (Control Room → Venue Operation Centre) needs a `SAME_AS` link, not just the query-time synonym |
| 5 | Which documents does the corpus **reference but not contain**? | `[PARTIAL]` | `refs` holds 141 unresolved external refs; answerable as a report but not surfaced anywhere |
| 6 | What is the definition of "Stadium", and which clauses rely on it? | `[OK]` | terms + `defines_term` edges + clause page |
| 7 | What must a stadium control room contain? | `[OK]` | verified by `pairs.json` #1 |
| 8 | What medical and doping facilities must a stadium provide? | `[OK]` | Ask / hybrid search |
| 9 | List every mandatory (**shall**) requirement for spectator safety. | `[PARTIAL]` | obligation-type facet + topic search; no true "all requirements in scope X" aggregate |
| 10 | Which clauses are informative vs normative? | `[OK]` | `normativity` field |

**The signal:** the `[GAP]` rows (1, 2, 3) all point at the **same missing model element — `APPLIES_TO(category)`**. That is the one extraction/modeling investment that would unlock the core compliance question ("what must a Category X stadium do?"). Competency questions are how we know that, before building it.

**Next:** the `[OK]` rows can be promoted into `pairs.json` as graded regression pairs; the `[GAP]` rows are the roadmap.
