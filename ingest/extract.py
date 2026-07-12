"""
Extract a full policy/standards PDF into Clause records (shared/models.py).

Parses every page with PyMuPDF, extracts each page-chunk with the LLM
(verbatim-faithful, structured output), validates against the Clause contract,
and writes JSONL to data/out/. Also publishes a review bundle (PDF + clauses +
manifest entry) into studio/public/extractions/ for the studio review tab.

    uv run python -m ingest.extract "<pdf>" <STANDARD_ID> --title "<Title>"
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import anthropic
import fitz  # PyMuPDF
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from shared.models import Clause, Normativity, Obligation, Provenance

load_dotenv()

MODEL = "claude-opus-4-8"
CHUNK_PAGES = 4  # pages per LLM call
OUT_DIR = Path("data/out")
REVIEW_DIR = Path("studio/public/extractions")


class ExtractedClause(BaseModel):
    clause_path: str = Field(description="Clause/article number as printed, e.g. '54' or 'DEF-Stadium'")
    heading_trail: str = Field(description="Breadcrumb of headings, e.g. 'Section 8: Closing Provisions'")
    page: int = Field(description="Printed page number this clause appears on")
    pdf_file_page: int = Field(description="PDF page index (0-based) this clause appears on")
    block_type: str = "paragraph"
    verbatim_text: str = Field(description="Exact source text, never paraphrased")
    obligation_type: Obligation
    normativity: Normativity
    references: list[str] = Field(default_factory=list)
    defined_terms: list[str] = Field(default_factory=list)
    anticipated_questions: list[str] = Field(description="3-5 questions this clause answers (1-2 for trivial ones)")


class Extraction(BaseModel):
    clauses: list[ExtractedClause]


PROMPT = """You are extracting a policy/standards document into structured clauses.

Standard: {title}, standard_id = {standard_id}

Below is a portion of the document, one page per block, each marked with its PDF
page index (0-based). Extract every distinct clause, article, or defined term as
one item.

Rules:
- verbatim_text MUST be the exact source text. Never paraphrase, summarise, or fix typos.
- clause_path: the printed article/section number (e.g. "54"). For a defined term
  with no number, use "DEF-<Term>" (e.g. "DEF-Control Room").
- page: the printed page number shown on the page (usually in the header/footer).
  pdf_file_page: the PDF page index from the "=== PDF page index N ===" marker.
- obligation_type: requirement (shall/must), recommendation (should), permission
  (may), or informative (definitions, notes, background with no obligation).
- normativity: "normative" for rules that must be conformed to, "informative" otherwise.
- references: ids/names of other standards, annexes, or clauses this text points to. Empty if none.
- defined_terms: terms this clause defines (the term itself for a definition entry).
- anticipated_questions: 3-5 natural-language questions this clause answers (1-2 is
  fine for a trivial one-line definition). Phrase them as real user questions.
- Skip pure cover pages and tables of contents.

Document portion:
{document}
"""


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def mint_uri(standard_id: str, clause_path: str) -> str:
    return f"https://stadia.example/clause/{slug(standard_id)}/{slug(clause_path)}"


def page_chunks(pdf: fitz.Document, size: int):
    """Yield windows of (pdf_index, text) for non-empty pages, overlapping by one
    page so a clause spanning a chunk boundary is fully seen in some window."""
    pages = [(i, pdf[i].get_text("text").strip()) for i in range(len(pdf))]
    pages = [(i, t) for i, t in pages if len(t) >= 50]
    step = max(1, size - 1)  # 1-page overlap between consecutive windows
    for start in range(0, len(pages), step):
        yield pages[start:start + size]
        if start + size >= len(pages):
            break


def dedup(clauses: list[dict]) -> list[dict]:
    """Drop fragments and exact repeats from the page overlap: if a clause's text
    is contained in another clause on the same or adjacent page, keep the longer."""
    # fold smart quotes/dashes to ASCII so the same clause rendered with curly
    # quotes in one window and straight quotes in another compares equal
    punct = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"',
                           "–": "-", "—": "-"})
    norm = lambda s: re.sub(r"\s+", " ", s.translate(punct)).strip().lower()
    order = sorted(enumerate(clauses), key=lambda kv: len(kv[1]["verbatim_text"]), reverse=True)
    kept: list[tuple[int, dict]] = []
    for idx, c in order:  # longest first so partials lose to the complete version
        n = norm(c["verbatim_text"])
        if n and any(abs(k["pdf_file_page"] - c["pdf_file_page"]) <= 1 and n in norm(k["verbatim_text"])
                     for _, k in kept):
            continue
        kept.append((idx, c))
    kept.sort(key=lambda kv: kv[0])  # restore document order
    return [c for _, c in kept]


def extract_chunk(client, title, standard_id, chunk) -> list[ExtractedClause]:
    document = "\n\n".join(f"=== PDF page index {i} ===\n{t}" for i, t in chunk)
    resp = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        messages=[{"role": "user", "content": PROMPT.format(title=title, standard_id=standard_id, document=document)}],
        output_format=Extraction,
    )
    return resp.parsed_output.clauses, resp.usage


def publish(standard_id, title, pdf_path: Path, clauses: list[dict]) -> None:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    s = slug(standard_id)
    shutil.copyfile(pdf_path, REVIEW_DIR / f"{s}.pdf")
    (REVIEW_DIR / f"{s}.json").write_text(json.dumps(clauses, indent=2), encoding="utf-8")

    manifest_path = REVIEW_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else []
    manifest = [m for m in manifest if m["id"] != s]
    manifest.append({"id": s, "title": title, "pdf": f"{s}.pdf", "data": f"{s}.json", "count": len(clauses)})
    manifest.sort(key=lambda m: m["title"])
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("standard_id")
    ap.add_argument("--title", default=None)
    args = ap.parse_args()
    title = args.title or args.standard_id

    client = anthropic.Anthropic()
    prov = Provenance(extracted_by=f"stadia@{MODEL}",
                      extracted_at=datetime.now(timezone.utc).isoformat())

    doc = fitz.open(args.pdf)
    n_pages = len(doc)
    clauses: list[dict] = []
    in_tok = out_tok = skipped = 0
    for chunk in page_chunks(doc, CHUNK_PAGES):
        idxs = [i for i, _ in chunk]
        extracted, usage = extract_chunk(client, title, args.standard_id, chunk)
        in_tok += usage.input_tokens
        out_tok += usage.output_tokens
        for ec in extracted:
            try:
                clause = Clause(standard_id=args.standard_id,
                                uri=mint_uri(args.standard_id, ec.clause_path),
                                provenance=prov, **ec.model_dump())
            except Exception as e:
                skipped += 1
                print(f"  skip {ec.clause_path}: {e}")
                continue
            clauses.append(clause.model_dump())
        print(f"pages {idxs}: +{len(extracted)} clauses (running total {len(clauses)})")
    doc.close()

    before = len(clauses)
    clauses = dedup(clauses)
    print(f"dedup (overlap fragments/repeats): {before} -> {len(clauses)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{slug(args.standard_id)}.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for c in clauses:
            f.write(json.dumps(c) + "\n")

    publish(args.standard_id, title, args.pdf, clauses)
    print(f"\nDone: {len(clauses)} clauses from {n_pages} pages "
          f"({skipped} skipped, {in_tok} in / {out_tok} out tokens)")
    print(f"  -> {out}")
    print(f"  -> {REVIEW_DIR}/  (for the studio review tab)")


if __name__ == "__main__":
    main()
