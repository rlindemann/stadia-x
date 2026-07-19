"""
APPLIES_TO extraction.

The "required per Stadium Category" compliance matrices are extracted as free text
inside clause_figures.transcription, so "what must a Category B stadium comply with?"
is unanswerable by query. This parses those matrices into structured rows in
clause_applicability: one row per (requirement x category) cell, with the raw value
and a normalized modality (mandatory | best_practice | non_applicable).

    uv run python -m ingest.applies_to                          # all standards
    uv run python -m ingest.applies_to AFC-STADIUM-REGULATIONS-2026

Idempotent per figure (re-running replaces that figure's rows).
"""

from __future__ import annotations

import json
import os
import re
import sys

import anthropic
import psycopg
from dotenv import load_dotenv

load_dotenv()

MODEL = "claude-opus-4-8"
anthro = anthropic.Anthropic()

SCHEMA = {
    "type": "object",
    "properties": {
        "is_category_matrix": {"type": "boolean"},
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "req_ref": {"type": ["string", "null"]},
                    "requirement": {"type": "string"},
                    "cells": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "category": {"type": "string", "enum": ["A", "B", "C", "D", "E"]},
                                "value": {"type": "string"},
                                "modality": {"type": "string", "enum": ["mandatory", "best_practice", "non_applicable"]},
                            },
                            "required": ["category", "value", "modality"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["req_ref", "requirement", "cells"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_category_matrix", "rows"],
    "additionalProperties": False,
}

PROMPT = """This is the transcription of a table from a stadium standards document.
If it is a "requirements per Stadium Category" matrix (its columns are the Stadium
Categories CAT A ... CAT E), extract EVERY row. For each row give:
- req_ref: the row's reference number (e.g. "15.2.1"), or null if none
- requirement: the requirement text / row label
- cells: one entry per category column present, each with:
  - value: the exact cell content ("8", "Min. 4", "mandatory", "best practice", ...)
  - modality: classify the cell as
    - "mandatory": the cell is "mandatory", a check mark, blank-but-required, OR a
      concrete numeric/spec value (the requirement applies at that value)
    - "best_practice": "best practice", "recommended", or a triangle
    - "non_applicable": "not applicable", a cross, or a dash meaning it does not apply

If the table is NOT a per-category matrix (a single-column spec, a diagram caption,
a plain list), set is_category_matrix=false and return rows=[].

Transcription:
"""


def parse(transcription: str) -> dict:
    resp = anthro.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{"role": "user", "content": PROMPT + transcription}],
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
    )
    txt = "".join(b.text for b in resp.content if b.type == "text")
    return json.loads(txt)


def main() -> None:
    std = sys.argv[1] if len(sys.argv) > 1 else None
    conn = psycopg.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    q = "select id, clause_id, standard_id, transcription from clause_figures where transcription is not null"
    params: list = []
    if std:
        q += " and standard_id = %s"
        params = [std]
    cur.execute(q, params)
    figs = cur.fetchall()
    print(f"{len(figs)} figures to scan", flush=True)

    total = 0
    for fid, cid, sid, trans in figs:
        if not re.search(r"CAT\s*A", trans or "", re.I):  # cheap pre-filter for a category matrix
            continue
        try:
            d = parse(trans)
        except Exception as e:
            print(f"  fig {fid}: parse failed: {e}", flush=True)
            continue
        if not d.get("is_category_matrix"):
            print(f"  fig {fid} ({sid}): not a category matrix", flush=True)
            continue

        cur.execute("delete from clause_applicability where figure_id = %s", (fid,))
        n = 0
        for row in d["rows"]:
            ref = (row.get("req_ref") or "").strip() or None
            link = None
            if ref:
                cur.execute(
                    "select id from clauses where standard_id = %s and clause_path = %s limit 1",
                    (sid, ref.rstrip(".")),
                )
                r = cur.fetchone()
                link = r[0] if r else None
            link = link or cid
            for cell in row["cells"]:
                cur.execute(
                    """insert into clause_applicability
                       (standard_id, figure_id, clause_id, req_ref, requirement, category, value, modality)
                       values (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (sid, fid, link, ref, row["requirement"], cell["category"], cell["value"], cell["modality"]),
                )
                n += 1
        conn.commit()
        total += n
        print(f"  fig {fid} ({sid}): +{n} cells from {len(d['rows'])} rows", flush=True)

    print(f"done: {total} applicability cells", flush=True)
    conn.close()


if __name__ == "__main__":
    main()
