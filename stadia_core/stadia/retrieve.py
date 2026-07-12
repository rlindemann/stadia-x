"""Hybrid retrieval: semantic candidates -> SPARQL enrichment for structure + provenance.

The net-new capability DeixOn lacks. Precise paragraph retrieval is lexical + semantic +
structural, not exact-match SPARQL. Embed each fragment's verbatim_text at load, keyed by
URI; at query time do semantic top-k, then hand the URIs to SPARQL to pull the exact
citation, parent standard, and cross-references.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Protocol

from .load import Fuseki


class EmbeddingIndex(Protocol):
    def upsert(self, uri: str, vector: list[float], text: str) -> None: ...
    def search(self, vector: list[float], k: int) -> list[str]: ...


@dataclass
class InMemoryIndex:
    """Cosine over an in-memory matrix. Fine for a dev index / a few 100k fragments.
    Swap for pgvector or Qdrant in production — same two-method interface."""

    _uris: list[str] = field(default_factory=list)
    _vecs: list[list[float]] = field(default_factory=list)

    def upsert(self, uri: str, vector: list[float], text: str = "") -> None:
        self._uris.append(uri)
        self._vecs.append(vector)

    def search(self, vector: list[float], k: int = 20) -> list[str]:
        import numpy as np

        if not self._vecs:
            return []
        m = np.array(self._vecs)
        q = np.array(vector)
        sims = m @ q / (np.linalg.norm(m, axis=1) * np.linalg.norm(q) + 1e-9)
        idx = sims.argsort()[::-1][:k]
        return [self._uris[i] for i in idx]


ENRICH = """
SELECT ?u ?text ?src ?parent WHERE {{
  VALUES ?u {{ {values} }}
  ?u <{ont}verbatimText> ?text .
  OPTIONAL {{ ?u <http://purl.org/dc/terms/source> ?src }}
  OPTIONAL {{ ?u <{ont}partOf> ?parent }}
}}"""


@dataclass
class Retriever:
    index: EmbeddingIndex
    embed: Callable[[str], list[float]]      # plug voyage / openai / sentence-transformers
    fuseki: Fuseki = field(default_factory=Fuseki)
    ontology_base: str = ""

    def __post_init__(self) -> None:
        if not self.ontology_base:
            from .config import settings

            self.ontology_base = settings.ontology_base

    def retrieve(self, question: str, k: int = 20) -> list[dict]:
        uris = self.index.search(self.embed(question), k)
        if not uris:
            return []
        values = " ".join(f"<{u}>" for u in uris)
        rows = self.fuseki.query(ENRICH.format(values=values, ont=self.ontology_base))
        return [{c: r[c]["value"] for c in r} for r in rows]
