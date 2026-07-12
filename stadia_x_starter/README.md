# stadia_x_starter

The two reusable cores of KYRA, extracted as standalone modules — domain-agnostic
(no podcast schema) and store-agnostic (no ChromaDB). Drop them into the Stadia-X
repo and wire your own ingest, schema, and datastore around them.

See `docs/STADIA_X_REPLICATION.md` for the full architecture. These two files are
the parts that judgement called "copy verbatim."

- `extract_harness.py` — multipass LLM extraction harness: checkpoint/resume,
  budget hard-cap, retry/backoff, thread-pool + API semaphore, dead-letter queue,
  schema-hash versioning, JSONL logging. You define the passes and prompts.
- `hybrid_search.py` — hybrid search: dense + BM25(canonical tokens) + Reciprocal
  Rank Fusion + exact-phrase bonus + cross-encoder rerank + structural blend
  (coverage + phrase proximity + per-field boost), with a transparent per-hit
  score breakdown. You supply a `Retriever` and (optionally) synonym groups.

Deps: `anthropic`, `python-dotenv`, `rank-bm25`; optional `google-genai` (Gemini
path) and `sentence-transformers` (the reranker — search degrades to the fused
score without it). Env: `ANTHROPIC_API_KEY` (and `GOOGLE_API_KEY` for Gemini).

---

## 1. Extraction — define passes, run a batch

The harness threads an accumulating `context` dict through your passes. Each
pass's output is stored under `context[pass.name]`, so later passes can read
earlier ones. Everything else (cost, retry, checkpoint, parallelism) is handled.

```python
import json
from pathlib import Path
from extract_harness import (
    ExtractionHarness, Pass, BudgetTracker, ModelConfig, SONNET,
    setup_logging, new_run_id,
)

# --- Stadia-X pass 1: document + entities ---------------------------------
DOC_SCHEMA = {
    "document": {"standard_id": "e.g. ISO 19650-1:2018", "title": "...",
                 "publisher": "SDO", "version": "...", "status": "active|superseded",
                 "jurisdiction": "...", "effective_date": "YYYY-MM-DD"},
    "defined_terms": [{"term": "...", "definition": "...", "clause_path": "3.1"}],
    "standards_referenced": [{"standard_id": "...", "title": "..."}],
}

def build_doc_prompt(ctx: dict) -> str:
    d = ctx["document_text"]  # from your loader (seed context)
    return (
        "Extract the document header, defined terms, and referenced standards.\n"
        "Return a single valid JSON object; no markdown, no preamble.\n\n"
        f"DOCUMENT:\n{d}\n\n"
        f"Return this exact structure:\n{json.dumps(DOC_SCHEMA, indent=2)}\n\n"
        "Return ONLY the JSON object, nothing else"
    )

def validate_doc(data: dict) -> None:
    if not data.get("document", {}).get("standard_id"):
        raise ValueError("missing standard_id")

# --- Stadia-X pass 2: requirements + cross-references ---------------------
def build_reqs_prompt(ctx: dict) -> str:
    header = ctx["pass1_doc"]["document"]           # read pass 1 output
    return f"... {json.dumps(header)} ... {ctx['document_text']} ..."

passes = [
    Pass("pass1_doc", build_doc_prompt, validate_doc),
    Pass("pass2_reqs", build_reqs_prompt),
    # Pass("pass3_analysis", build_analysis_prompt),
]

harness = ExtractionHarness(
    passes=passes,
    model=SONNET,                                   # or OPUS / GEMINI_FLASH
    out_dir=Path("data/standards/extracted"),
    schema_files=[Path("shared/schemas/standard_object.yaml")],  # hashed into _audit
    max_api_calls=6,
)

run_id = new_run_id()
logger = setup_logging(Path("data/logs"), run_id)
budget = BudgetTracker(cap_usd=25.0)

# You load each document into a seed context dict. item_id may contain "/".
items = [
    ("iso-19650/part-1", {"document_text": load_text("iso-19650-1.pdf")}),
    ("iso-19650/part-2", {"document_text": load_text("iso-19650-2.pdf")}),
]

summary = harness.run_batch(items, budget, logger, run_id, workers=3)
print(summary["ok"], "ok /", summary["failed"], "failed, $", summary["total_cost_usd"])
# Output: data/standards/extracted/<item_id>/knowledge_object.json  (+ _audit.json)
# Failures land in data/standards/extracted/.failures/<run_id>.json
```

Re-running skips completed items and resumes partially-done ones from their
per-pass checkpoints. To retry only the failures:
`load_latest_dead_letter(out_dir)` returns the failed item ids.

Notes vs. KYRA: passes and schema are 100% yours (KYRA hardcoded 3 podcast
passes). The default merge shallow-merges every pass output into one object;
pass `merge_fn=...` to `ExtractionHarness` if you need custom assembly.

---

## 2. Search — implement a Retriever, then query

`hybrid_search` needs a `Retriever` with two methods. Any vector store works;
here is the recommended Postgres + pgvector adapter (per the blueprint's DB call).

```python
import psycopg
from sentence_transformers import SentenceTransformer
from hybrid_search import HybridSearch

class PgVectorRetriever:
    """clauses(id text, text text, embedding vector(768), meta jsonb) with an
    HNSW cosine index on embedding."""
    def __init__(self, dsn: str, model_name: str = "all-mpnet-base-v2"):
        self.conn = psycopg.connect(dsn)
        self.model = SentenceTransformer(model_name)

    def dense(self, query, n, where):
        vec = self.model.encode(query).tolist()
        sql = ("SELECT id, text, meta, embedding <=> %s::vector AS dist "
               "FROM clauses")
        params = [vec]
        if where:                       # hard filters on jsonb meta
            conds = " AND ".join(f"meta->>%s = %s" for _ in where)
            sql += " WHERE " + conds
            for k, v in where.items():
                params += [k, str(v)]
        sql += " ORDER BY dist LIMIT %s"
        params.append(n)
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return [(r[0], r[1], r[2], float(r[3])) for r in cur.fetchall()]

    def all_docs(self):
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, text, meta FROM clauses")
            rows = cur.fetchall()
        ids  = [r[0] for r in rows]
        docs = [r[1] for r in rows]
        metas = [r[2] for r in rows]
        return ids, docs, metas

search = HybridSearch(
    PgVectorRetriever("postgresql://stadia:stadia@localhost:5432/stadia"),
    synonym_groups=[
        ["BIM", "building information modeling", "building information modelling"],
        ["CDE", "common data environment"],
        ["IFC", "industry foundation classes"],
    ],
    # Re-point field boosts at your schema: a hit whose clause heading or
    # standard_id matches the query outranks an incidental body mention.
    field_boosts={
        "standard": (["standard_id"], 1.0),
        "clause":   (["clause_path", "heading"], 1.0),
        "tag":      (["jurisdiction", "obligation_type"], 0.6),
    },
    embed_device="cpu",
)

hits = search.search(
    "fire compartmentation requirements for residential buildings",
    where={"status": "active"},       # hard filter passed to your retriever
    limit=20,
)
for h in hits:
    print(h.score, h.meta.get("standard_id"), h.meta.get("clause_path"))
    print("  ", h.text[:120])
    print("  sem", h.semantic, "lex", h.lexical, "cov", h.coverage,
          "fields", h.matched_fields)   # transparent breakdown for the UI
```

Notes vs. KYRA: `Hit` carries a generic `meta` passthrough instead of hardcoded
`episode_title`/`speaker`, so it fits any schema. The synonym groups and field
boosts are constructor args, not a fixed YAML. The reranker is lazy and optional;
if `sentence-transformers` isn't installed, search falls back to the fused score
automatically (`hit.reranked == False`).

### BM25 in-database (optional)

`hybrid_search` builds its BM25 index in memory over the whole corpus (fine up to
~10^5 chunks). For a larger corpus, move the sparse side into Postgres with
`pg_search` / ParadeDB (real BM25 index) or `tsvector` + `ts_rank`, and have your
`Retriever` expose a `sparse()` method — then the whole pipeline runs in one DB.
The fusion/rerank/blend code here stays unchanged.
