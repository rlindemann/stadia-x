"""
Generate a larger retrieval eval set (eval at scale).

The hand-curated studio/eval/pairs.json is human-approved but tiny (~10), too small
to measure a ranking change. This samples real clauses and has an LLM write ONE
natural user question each answers, in DIFFERENT words than the clause (so it tests
semantic/contextual retrieval, not lexical echo). Ground truth = that clause id.

Writes studio/eval/pairs-generated.json. Synthetic (for scale / regression signal),
complementary to the approved pairs, not a replacement.

    uv run python -m ingest.gen_eval [N]     # default 70 pairs

Deterministic sample given the same seed so re-runs are comparable.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
from pathlib import Path

import anthropic
import psycopg
from dotenv import load_dotenv

load_dotenv()

MODEL = "claude-haiku-4-5-20251001"
CONCURRENCY = 8
OUT = Path(__file__).resolve().parents[1] / "studio" / "eval" / "pairs-generated.json"

PROMPT = """A user is searching a stadium-standards database in plain language. Write ONE
natural question that the clause below answers. Use everyday wording and DIFFERENT words
than the clause where you can (test real retrieval, not word matching). One question, no
preamble, no quotes.

Clause {path} ({standard}): {text}"""


async def gen_q(client, sem, row) -> str:
    _cid, _path, _sid, text, path, standard = row
    async with sem:
        msg = await client.messages.create(
            model=MODEL, max_tokens=60,
            messages=[{"role": "user", "content": PROMPT.format(
                path=path, standard=standard, text=(text or "")[:500])}],
        )
        return "".join(b.text for b in msg.content if b.type == "text").strip()


async def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 70
    conn = psycopg.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    # substantive clauses only (skip pure definitions and very short rows), across standards
    cur.execute(
        """select c.id, c.clause_path, c.standard_id, c.verbatim_text, c.clause_path, s.title
           from clauses c join standards s on s.id = c.standard_id
           where c.clause_path not like 'DEF-%%' and length(c.verbatim_text) > 80
             and coalesce(s.meta->>'review_status','published') <> 'pending'"""
    )
    rows = cur.fetchall()
    conn.close()

    random.seed(42)
    sample = random.sample(rows, min(n, len(rows)))
    print(f"sampled {len(sample)} clauses from {len(rows)}", flush=True)

    sem = asyncio.Semaphore(CONCURRENCY)
    async with anthropic.AsyncAnthropic() as client:
        questions = await asyncio.gather(*(gen_q(client, sem, r) for r in sample))

    pairs = [
        {"id": f"gen-{i}", "q": q, "clause_id": row[0], "clause_path": row[1],
         "standard_id": row[2], "generated": True}
        for i, (row, q) in enumerate(zip(sample, questions)) if q
    ]
    OUT.write_text(json.dumps(pairs, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(pairs)} pairs -> {OUT}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
