"""
First extraction run: AFC Stadium Regulations (Edition 2021) -> Clause records.

Proves the parse -> LLM-extract path end to end on one document, writing JSONL
that matches shared/models.py. Run:

    uv run python -m ingest.extract_afc

The LLM fills the meaning fields (obligation, references, defined terms,
anticipated questions) verbatim-faithfully; page/clause structure comes from the
PDF. This is the calibration target -- keep the section small enough to eyeball.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import anthropic
import fitz  # PyMuPDF
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from shared.models import Clause, Obligation, Normativity, Provenance

load_dotenv()

MODEL = "claude-opus-4-8"
PDF = Path("data/OneDrive_3_12-07-2026/AFC_Stadium Regulations (Edition 2021).pdf")
STANDARD_ID = "AFC-STADIUM-REGULATIONS-2021"
OUT = Path("data/out/afc_2021_clauses.jsonl")


# --- extraction contract (bounds relaxed vs shared.Clause so one bad item
#     doesn't fail the whole batch; the strict Clause validates at write time) ---
class ExtractedClause(BaseModel):
    clause_path: str = Field(description="Clause/article number as printed, e.g. '5.2' or 'DEF-Stadium'")
    heading_trail: str = Field(description="Breadcrumb of headings, e.g. 'Definitions'")
    page: int = Field(description="Printed page number this clause appears on")
    pdf_file_page: int = Field(description="PDF page index (0-based) this clause appears on")
    block_type: str = "paragraph"
    verbatim_text: str = Field(description="Exact source text, never paraphrased")
    obligation_type: Obligation
    normativity: Normativity
    references: list[str] = Field(default_factory=list)
    defined_terms: list[str] = Field(default_factory=list)
    anticipated_questions: list[str] = Field(description="3-5 questions this clause answers")


class Extraction(BaseModel):
    clauses: list[ExtractedClause]


PROMPT = """You are extracting a policy/standards document into structured clauses.

Standard: AFC Stadium Regulations (Edition 2021), standard_id = {standard_id}

Below is the document text, one page per block, each marked with its PDF page
index and printed page number. Extract every distinct clause, article, or defined
term as one item.

Rules:
- verbatim_text MUST be the exact source text. Never paraphrase, summarise, or fix typos.
- clause_path: use the printed article/section number (e.g. "54"). For a defined
  term with no number, use "DEF-<Term>" (e.g. "DEF-Control Room").
- obligation_type: requirement (shall/must), recommendation (should), permission
  (may), or informative (definitions, notes, background with no obligation).
- normativity: "normative" for rules that must be conformed to, "informative" for
  definitions/notes/background.
- references: ids or names of other standards/annexes/clauses this text points to
  (e.g. "STA", "FIFA Quality Programme"). Empty list if none.
- defined_terms: terms this clause defines. For a definition entry, the term itself.
- anticipated_questions: 3 to 5 natural-language questions a user could ask that
  this clause answers. Phrase them as real questions.

Document text:
{document}
"""


def load_pages(pdf: Path, want: range) -> tuple[str, list[int]]:
    doc = fitz.open(pdf)
    blocks, used = [], []
    for i in want:
        if i >= len(doc):
            break
        text = doc[i].get_text("text").strip()
        if len(text) < 50:  # skip near-empty pages
            continue
        blocks.append(f"=== PDF page index {i} ===\n{text}")
        used.append(i)
    doc.close()
    return "\n\n".join(blocks), used


def find_definitions_start(pdf: Path) -> int:
    doc = fitz.open(pdf)
    try:
        for i in range(len(doc)):
            if re.search(r"^\s*DEFINITIONS\s*$", doc[i].get_text("text"), re.MULTILINE):
                return i
    finally:
        doc.close()
    return 5  # fallback


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def mint_uri(standard_id: str, clause_path: str) -> str:
    return f"https://stadia.example/clause/{slug(standard_id)}/{slug(clause_path)}"


def main() -> None:
    start = find_definitions_start(PDF)
    document, used = load_pages(PDF, range(start, start + 3))
    print(f"Extracting PDF pages {used} of {PDF.name}")

    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        messages=[{"role": "user", "content": PROMPT.format(standard_id=STANDARD_ID, document=document)}],
        output_format=Extraction,
    )
    extraction = response.parsed_output
    print(f"LLM returned {len(extraction.clauses)} clauses "
          f"({response.usage.input_tokens} in / {response.usage.output_tokens} out tokens)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prov = Provenance(extracted_by=f"stadia@{MODEL}", extracted_at="2026-07-12T00:00:00Z")
    written, skipped = 0, 0
    with OUT.open("w", encoding="utf-8") as f:
        for ec in extraction.clauses:
            try:
                clause = Clause(
                    standard_id=STANDARD_ID,
                    uri=mint_uri(STANDARD_ID, ec.clause_path),
                    provenance=prov,
                    **ec.model_dump(),
                )
            except Exception as e:  # strict-contract validation (e.g. question count)
                skipped += 1
                print(f"  skip {ec.clause_path}: {e}")
                continue
            f.write(clause.model_dump_json() + "\n")
            written += 1
    print(f"Wrote {written} clauses to {OUT} ({skipped} skipped)")


if __name__ == "__main__":
    main()
