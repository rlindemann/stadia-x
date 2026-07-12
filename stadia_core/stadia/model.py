"""Core data model: one definition every parser/extractor targets and the emitter reads."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class SourceAnchor:
    """Golden-thread pointer back to the exact spot in the source document."""

    doc_id: str
    page: int | None = None          # printed page a human cites
    file_page: int | None = None     # physical PDF page (page != file page)
    char_start: int | None = None
    char_end: int | None = None

    def dct_source(self) -> str:
        loc = self.file_page or self.page
        return f"{self.doc_id}#page={loc}" if loc else self.doc_id


@dataclass
class Provenance:
    extracted_by: str
    extracted_on: date
    confidence: str = "verbatim"     # verbatim | derived | failed


@dataclass
class Segment:
    """A chunk of source text with its anchor and any structural hints."""

    text: str
    anchor: SourceAnchor
    hint: dict = field(default_factory=dict)   # {"heading": ..., "level": ..., "code": ...}


@dataclass
class Entity:
    """One node in the graph: a clause, paragraph, standard, requirement, decision..."""

    uri: str
    type: str                        # curie e.g. "sx:Clause", or a full IRI
    verbatim_text: str = ""          # character-faithful; never paraphrased
    label: str = ""
    part_of: str | None = None       # parent URI (document/section hierarchy)
    anchor: SourceAnchor | None = None
    prov: Provenance | None = None
    props: dict[str, object] = field(default_factory=dict)       # datatype properties
    links: dict[str, list[str]] = field(default_factory=dict)    # object properties -> URIs
