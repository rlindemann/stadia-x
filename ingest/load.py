"""
Load extracted clauses (data/out/*.jsonl) into Neon Postgres with embeddings.

Embeds clause text and each anticipated question with Voyage, then inserts
standards / clauses / clause_questions / terms / refs. Idempotent per standard
(re-running replaces that standard's clauses).

    uv run python -m ingest.init_db            # once, creates the schema
    uv run python -m ingest.load data/out/afc-stadium-regulations-2021.jsonl \
        AFC-STADIUM-REGULATIONS-2021 --title "AFC Stadium Regulations (Edition 2021)"
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
import psycopg
import voyageai
from dotenv import load_dotenv
from pgvector.psycopg import register_vector

from ingest.build_graph import main as build_graph
from ingest.extract import slug
from ingest.figures import run as extract_figures
from ingest.storage import upload_bytes, upload_pdf

load_dotenv()

EMBED_MODEL = "voyage-3.5"
EMBED_DIM = 1024
BATCH = 128  # Voyage per-request cap

vo = voyageai.Client()  # reads VOYAGE_API_KEY


def embed(texts: list[str], input_type: str) -> list[np.ndarray]:
    out: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        r = vo.embed(texts[i:i + BATCH], model=EMBED_MODEL, input_type=input_type,
                     output_dimension=EMBED_DIM)
        out.extend(r.embeddings)
    return [np.asarray(v, dtype=np.float32) for v in out]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl", type=Path)
    ap.add_argument("standard_id")
    ap.add_argument("--title", required=True)
    ap.add_argument("--publisher", default=None)
    ap.add_argument("--pdf", type=Path, default=None, help="source PDF to upload to R2")
    ap.add_argument("--supersedes", default=None, help="standard_id this edition replaces")
    ap.add_argument("--no-figures", action="store_true", help="skip table/figure extraction")
    args = ap.parse_args()

    rows = [json.loads(line) for line in args.jsonl.open(encoding="utf-8")]
    print(f"loading {len(rows)} clauses for {args.standard_id}")

    source_url = thumb_url = None
    if args.pdf:
        s = slug(args.standard_id)
        source_url = upload_pdf(args.pdf, f"standards/{s}.pdf")
        doc = fitz.open(args.pdf)
        png = doc[0].get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).tobytes("png")  # title-page thumbnail
        doc.close()
        thumb_url = upload_bytes(png, f"standards/{s}-thumb.png", "image/png")
        print(f"uploaded PDF -> {source_url}")
        print(f"uploaded thumb -> {thumb_url}")

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            cur.execute(
                """insert into standards (id, title, publisher, source_url, thumb_url, supersedes, status)
                   values (%s, %s, %s, %s, %s, %s, %s)
                   on conflict (id) do update set title = excluded.title,
                       publisher = excluded.publisher,
                       source_url = coalesce(excluded.source_url, standards.source_url),
                       thumb_url = coalesce(excluded.thumb_url, standards.thumb_url),
                       supersedes = coalesce(excluded.supersedes, standards.supersedes),
                       status = coalesce(excluded.status, standards.status)""",
                (args.standard_id, args.title, args.publisher, source_url, thumb_url,
                 args.supersedes, "Current" if args.supersedes else None),
            )
            if args.supersedes:
                cur.execute("update standards set status = 'Superseded' where id = %s", (args.supersedes,))
            cur.execute("delete from clauses where standard_id = %s", (args.standard_id,))

            print("embedding clause text...")
            clause_vecs = embed([r["verbatim_text"] for r in rows], "document")

            clause_ids: list[int] = []
            for r, vec in zip(rows, clause_vecs):
                cur.execute(
                    """insert into clauses
                       (standard_id, clause_path, heading_trail, page, pdf_file_page, block_type,
                        obligation_type, normativity, verbatim_text, defined_terms, uri, embedding)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                    (args.standard_id, r["clause_path"], r["heading_trail"], r["page"],
                     r["pdf_file_page"], r["block_type"], r["obligation_type"], r["normativity"],
                     r["verbatim_text"], r["defined_terms"], r["uri"], vec),
                )
                cid = cur.fetchone()[0]
                clause_ids.append(cid)
                for term in r["defined_terms"]:
                    cur.execute(
                        "insert into terms (term, defined_in_clause, standard_id) values (%s,%s,%s)",
                        (term, cid, args.standard_id),
                    )
                for ref in r["references"]:
                    cur.execute("insert into refs (from_clause, raw) values (%s,%s)", (cid, ref))

            q_pairs = [(cid, q) for cid, r in zip(clause_ids, rows)
                       for q in r["anticipated_questions"]]
            if q_pairs:
                print(f"embedding {len(q_pairs)} anticipated questions...")
                q_vecs = embed([q for _, q in q_pairs], "document")
                for (cid, q), qv in zip(q_pairs, q_vecs):
                    cur.execute(
                        "insert into clause_questions (clause_id, question, embedding) values (%s,%s,%s)",
                        (cid, q, qv),
                    )
        conn.commit()
    print(f"done: {len(rows)} clauses, {len(q_pairs)} questions loaded.")

    # Extract tables/figures (render -> R2 -> vision transcribe -> embed) when a
    # source PDF is available; skip with --no-figures.
    if args.pdf and not args.no_figures:
        print("extracting tables/figures...")
        extract_figures(str(args.pdf), args.standard_id)

    # Refresh the GraphRAG edges so multi-hop traversal reflects the new clauses.
    print("rebuilding knowledge-graph edges...")
    build_graph()


if __name__ == "__main__":
    main()
