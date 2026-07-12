"""Parsers: source file -> Segments. One implementation per FORMAT, not per document."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Protocol

from .model import Segment, SourceAnchor


class Parser(Protocol):
    def segments(self, path: Path) -> Iterable[Segment]: ...


class TextParser:
    """Plain text / markdown: split on blank lines into paragraph segments."""

    def segments(self, path: Path) -> Iterable[Segment]:
        doc_id = path.name
        offset = 0
        for block in path.read_text(encoding="utf-8").split("\n\n"):
            stripped = block.strip()
            if stripped:
                yield Segment(stripped, SourceAnchor(doc_id, char_start=offset), {})
            offset += len(block) + 2


class JsonlParser:
    """Pre-structured JSONL: one object per line with a 'text' field."""

    text_field = "text"

    def segments(self, path: Path) -> Iterable[Segment]:
        doc_id = path.name
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            yield Segment(obj.get(self.text_field, ""), SourceAnchor(doc_id), obj)


class PdfHeadingParser:
    """Layout-aware PDF: promote large/bold spans to section boundaries.

    Handles most well-structured PDFs without per-document regex. Reserve bespoke
    code for genuinely irregular sources; feed everything else through this.
    """

    def __init__(self, heading_pt: float = 12.0):
        self.heading_pt = heading_pt

    def segments(self, path: Path) -> Iterable[Segment]:
        import fitz  # pymupdf

        doc = fitz.open(str(path))
        doc_id = path.name
        buf: list[str] = []
        cur = SourceAnchor(doc_id, file_page=1)
        heading = ""
        for pno, page in enumerate(doc, start=1):
            for blk in page.get_text("dict")["blocks"]:
                for line in blk.get("lines", []):
                    for span in line.get("spans", []):
                        is_heading = span["size"] >= self.heading_pt and bool(span["flags"] & 16)
                        if is_heading and buf:
                            yield Segment("\n".join(buf).strip(), cur, {"heading": heading})
                            buf = []
                        if is_heading:
                            cur = SourceAnchor(doc_id, file_page=pno)
                            heading = span["text"].strip()
                        buf.append(span["text"])
        if buf:
            yield Segment("\n".join(buf).strip(), cur, {"heading": heading})


PARSERS = {"text": TextParser, "jsonl": JsonlParser, "pdf": PdfHeadingParser}


def get_parser(fmt: str) -> Parser:
    if fmt not in PARSERS:
        raise ValueError(f"Unknown format {fmt!r}. Choose from {list(PARSERS)}")
    return PARSERS[fmt]()
