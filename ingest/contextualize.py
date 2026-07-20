"""
Contextual Retrieval (Anthropic technique).

Each clause is embedded (and full-text indexed) on its own, so a clause like
"Minimum three (3)" is meaningless out of context. This writes a short LLM
sentence situating each clause in its document/section, stores it in
clauses.context, and re-embeds the clause as (context + verbatim_text). The
context is also folded into the tsvector (contextual BM25) via schema.

    uv run python -m ingest.contextualize                        # all clauses
    uv run python -m ingest.contextualize AFC-STADIUM-REGULATIONS-2026

Idempotent: re-running regenerates context and re-embeds.
"""

from __future__ import annotations

import asyncio
import os
import sys

import anthropic
import numpy as np
import psycopg
import voyageai
from dotenv import load_dotenv
from pgvector.psycopg import register_vector

load_dotenv()

CTX_MODEL = "claude-haiku-4-5-20251001"  # cheap/fast; context is short
EMBED_MODEL = "voyage-3.5"
EMBED_DIM = 1024
CONCURRENCY = 8
BATCH = 128

PROMPT = """You are indexing a standards document for search. Write ONE short sentence
(max 25 words) situating the clause below within its document and section — what topic it
belongs to and what it covers — so a search engine can find it even out of context. Output
only the sentence, no preamble.

Document: {title}
Section: {trail}
Clause {path}: {text}"""


async def gen_context(client: anthropic.AsyncAnthropic, sem: asyncio.Semaphore, row) -> str:
    _cid, path, trail, text, title = row
    async with sem:
        msg = await client.messages.create(
            model=CTX_MODEL,
            max_tokens=80,
            messages=[{"role": "user", "content": PROMPT.format(
                title=title, trail=trail or "(top level)", path=path, text=(text or "")[:600])}],
        )
        return "".join(b.text for b in msg.content if b.type == "text").strip()


def migrate(cur) -> None:
    cur.execute(
        "select 1 from information_schema.columns where table_name='clauses' and column_name='context'"
    )
    if cur.fetchone():
        return
    print("migrating: add context column + fold it into tsv (contextual BM25)", flush=True)
    cur.execute("alter table clauses add column context text")
    cur.execute("alter table clauses drop column tsv")
    cur.execute(
        "alter table clauses add column tsv tsvector generated always as "
        "(to_tsvector('english', coalesce(context,'') || ' ' || verbatim_text)) stored"
    )
    cur.execute("create index if not exists clauses_tsv_idx on clauses using gin (tsv)")


async def main() -> None:
    std = sys.argv[1] if len(sys.argv) > 1 else None
    conn = psycopg.connect(os.environ["DATABASE_URL"])
    register_vector(conn)
    cur = conn.cursor()
    migrate(cur)
    conn.commit()

    q = ("select c.id, c.clause_path, c.heading_trail, c.verbatim_text, s.title "
         "from clauses c join standards s on s.id = c.standard_id")
    params: list = []
    if std:
        q += " where c.standard_id = %s"
        params = [std]
    q += " order by c.id"
    cur.execute(q, params)
    rows = cur.fetchall()
    print(f"{len(rows)} clauses to contextualize", flush=True)

    sem = asyncio.Semaphore(CONCURRENCY)
    async with anthropic.AsyncAnthropic() as client:
        contexts = await asyncio.gather(*(gen_context(client, sem, r) for r in rows))
    print("contexts generated; storing + re-embedding", flush=True)

    for (cid, *_), ctx in zip(rows, contexts):
        cur.execute("update clauses set context = %s where id = %s", (ctx, cid))
    conn.commit()

    vo = voyageai.Client()
    docs = [f"{ctx}\n\n{r[3]}" for r, ctx in zip(rows, contexts)]  # context + verbatim
    ids = [r[0] for r in rows]
    for i in range(0, len(docs), BATCH):
        chunk = docs[i:i + BATCH]
        vecs = vo.embed(chunk, model=EMBED_MODEL, input_type="document", output_dimension=EMBED_DIM).embeddings
        for cid, v in zip(ids[i:i + BATCH], vecs):
            cur.execute("update clauses set embedding = %s where id = %s",
                        (np.asarray(v, dtype=np.float32), cid))
        conn.commit()
        print(f"  re-embedded {min(i + BATCH, len(docs))}/{len(docs)}", flush=True)

    print(f"done: {len(rows)} clauses contextualized + re-embedded", flush=True)
    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
