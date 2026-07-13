"""
Extract a full policy/standards PDF into Clause records (shared/models.py).

Parses every page with PyMuPDF, extracts each page-chunk with the LLM
(verbatim-faithful, structured output), validates against the Clause contract,
and writes JSONL to data/out/. Load it into Neon with ingest/load.py.

    uv run python -m ingest.extract "<pdf>" <STANDARD_ID> --title "<Title>"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import anthropic
import fitz  # PyMuPDF
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from ingest.ocr import is_scanned, ocr_page
from shared.models import Clause, Normativity, Obligation, Provenance

load_dotenv()

MODEL = "claude-opus-4-8"
CHUNK_PAGES = 4  # pages per LLM call (auto-split smaller if a window overflows max_tokens)
MAX_TOKENS = 16000  # per-call output cap; must stay under the SDK's non-streaming limit
CONCURRENCY = 6  # windows extracted in parallel
OUT_DIR = Path("data/out")


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


def read_page_text(pdf: fitz.Document, i: int, ocr: bool) -> str:
    """Text layer for a page, falling back to OCR for scanned/image-only pages."""
    text = pdf[i].get_text("text").strip()
    if ocr and len(text) < 50 and is_scanned(pdf[i]):
        ocred = ocr_page(pdf[i])
        if ocred:
            print(f"  ocr page {i}: +{len(ocred)} chars")
            return ocred
    return text


def page_chunks(pdf: fitz.Document, size: int, ocr: bool = False):
    """Yield windows of (pdf_index, text) for non-empty pages, overlapping by one
    page so a clause spanning a chunk boundary is fully seen in some window."""
    pages = [(i, read_page_text(pdf, i, ocr)) for i in range(len(pdf))]
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


async def _call(client, title, standard_id, chunk, sem):
    """One extraction API call, holding a concurrency slot only for its duration."""
    document = "\n\n".join(f"=== PDF page index {i} ===\n{t}" for i, t in chunk)
    async with sem:
        return await client.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": PROMPT.format(title=title, standard_id=standard_id, document=document)}],
            output_format=Extraction,
        )


async def extract_window(client, title, standard_id, chunk, sem) -> tuple[list[ExtractedClause], int, int]:
    """Extract one window. If the response is truncated (too many clauses to fit
    max_tokens -> invalid JSON), split the window in half and extract each part,
    recursively, until it fits. Returns (clauses, input_tokens, output_tokens)."""
    idxs = [i for i, _ in chunk]
    try:
        resp = await _call(client, title, standard_id, chunk, sem)
        print(f"pages {idxs}: +{len(resp.parsed_output.clauses)} clauses", flush=True)
        return resp.parsed_output.clauses, resp.usage.input_tokens, resp.usage.output_tokens
    except Exception as e:
        if len(chunk) > 1:
            mid = len(chunk) // 2
            print(f"pages {idxs}: output too large, splitting {idxs[:mid]} | {idxs[mid:]}", flush=True)
            left, right = await asyncio.gather(
                extract_window(client, title, standard_id, chunk[:mid], sem),
                extract_window(client, title, standard_id, chunk[mid:], sem),
            )
            return left[0] + right[0], left[1] + right[1], left[2] + right[2]
        print(f"  page {idxs[0]}: extraction failed even at one page: {e}", flush=True)
        return [], 0, 0


async def run(args, title: str) -> None:
    prov = Provenance(extracted_by=f"stadia@{MODEL}",
                      extracted_at=datetime.now(timezone.utc).isoformat())

    doc = fitz.open(args.pdf)
    n_pages = len(doc)
    windows = list(page_chunks(doc, args.chunk_pages, ocr=args.ocr))  # reads/OCRs all page text
    doc.close()
    print(f"{n_pages} pages -> {len(windows)} windows; extracting up to {CONCURRENCY} in parallel", flush=True)

    sem = asyncio.Semaphore(CONCURRENCY)
    async with anthropic.AsyncAnthropic() as client:
        results = await asyncio.gather(
            *(extract_window(client, title, args.standard_id, w, sem) for w in windows)
        )

    extracted = [ec for r in results for ec in r[0]]
    in_tok = sum(r[1] for r in results)
    out_tok = sum(r[2] for r in results)

    clauses: list[dict] = []
    skipped = 0
    for ec in extracted:
        try:
            clause = Clause(standard_id=args.standard_id,
                            uri=mint_uri(args.standard_id, ec.clause_path),
                            provenance=prov, **ec.model_dump())
        except Exception as e:
            skipped += 1
            print(f"  skip {ec.clause_path}: {e}", flush=True)
            continue
        clauses.append(clause.model_dump())

    before = len(clauses)
    clauses = dedup(clauses)
    print(f"extracted {before} clauses -> dedup (overlap fragments/repeats) -> {len(clauses)}", flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{slug(args.standard_id)}.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for c in clauses:
            f.write(json.dumps(c) + "\n")

    print(f"\nDone: {len(clauses)} clauses from {n_pages} pages "
          f"({skipped} skipped, {in_tok} in / {out_tok} out tokens)", flush=True)
    print(f"  -> {out}   (next: load into Neon with `uv run python -m ingest.load ...`)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("standard_id")
    ap.add_argument("--title", default=None)
    ap.add_argument("--ocr", action="store_true",
                    help="OCR scanned/image-only pages (OCR_PROVIDER: tesseract|azure)")
    ap.add_argument("--chunk-pages", type=int, default=CHUNK_PAGES,
                    help="starting pages per LLM call; a window that overflows max_tokens is auto-split")
    args = ap.parse_args()
    asyncio.run(run(args, args.title or args.standard_id))


if __name__ == "__main__":
    main()
