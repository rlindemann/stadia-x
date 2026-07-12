"""stadia-core: source-agnostic policy/standards → RDF graph → query pipeline.

Six small generic modules replace DeixOn's per-document scripts:
  config    — one settings object, no hardcoded endpoints
  model     — the single Entity/Segment definition everything targets
  uri       — central versioned-URI minter
  parse     — source file -> Segments (one parser per FORMAT, not per document)
  extract   — Segment -> Entities (passthrough or schema-driven LLM)
  emit      — Entities -> rdflib Graph (no hand-built Turtle)
  reason    — optional OWL-RL closure (no hand-listed subclass INSERTs)
  load      — Fuseki loader over the Graph Store Protocol
  validate  — SHACL + SPARQL competency checks
  retrieve  — hybrid semantic + structural retrieval
"""

from .model import Entity, Segment, SourceAnchor, Provenance
from .config import settings

__all__ = ["Entity", "Segment", "SourceAnchor", "Provenance", "settings"]
