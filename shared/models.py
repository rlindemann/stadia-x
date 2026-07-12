"""
Stadia-X data contract — the single source of truth for a clause.

One `Clause` = one numbered clause of a standard (e.g. 5.2.1). This is the shape
the LLM extractor must return, the shape Postgres stores, and the shape search
ranks over. See docs/PLAN.md sections 6 and 6.1.

Granularity note: the clause is the stable anchor (its `uri` is what people cite).
Going finer later (per-sentence / per-requirement) does NOT mean re-ingesting the
PDF — it means splitting the already-stored `verbatim_text` into a child table
that points back to the clause. The clause rows and their citations never move.
The `clause_questions` table already follows exactly this parent/child pattern.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Obligation(str, Enum):
    """How binding the clause is — driven by the modal verb in the source."""

    requirement = "requirement"        # "shall" / "must"
    recommendation = "recommendation"  # "should"
    permission = "permission"          # "may"
    informative = "informative"        # no obligation; explanatory


class Normativity(str, Enum):
    normative = "normative"        # a rule that must be conformed to
    informative = "informative"    # notes, examples, background


class Provenance(BaseModel):
    """The golden thread — how this clause got here. Filled at extract time."""

    extracted_by: str                  # tool + model id, e.g. "stadia@claude-opus-4-8"
    extracted_at: str                  # ISO-8601 timestamp, stamped by the pipeline
    confidence: float | None = None    # extractor self-report, 0-1, optional


class Clause(BaseModel):
    """One numbered clause of a standard, with its full source anchor."""

    # --- parsed from the PDF structure (no LLM) ---
    standard_id: str                       # which document this belongs to
    clause_path: str                       # the clause number as printed, "5.2.1"
    heading_trail: str                     # breadcrumb, "Changing rooms > Dimensions"
    page: int                              # page number printed on the page
    pdf_file_page: int                     # page index within the PDF file
    block_type: str = "paragraph"          # paragraph | table | note | figure | ...
    verbatim_text: str                     # exact source text, never paraphrased

    # --- extracted by the LLM ---
    obligation_type: Obligation
    normativity: Normativity
    references: list[str] = Field(default_factory=list)      # ids of standards/clauses cited
    defined_terms: list[str] = Field(default_factory=list)   # terms this clause defines
    # Hypothetical Questions index. Aim for 3-5 (prompt enforces), but allow 1-2
    # for trivial definitions that genuinely answer fewer -- forcing 3 only pads.
    anticipated_questions: list[str] = Field(min_length=1, max_length=5)

    # --- computed at load time (no LLM) ---
    uri: str | None = None                 # stable versioned id; minted in one place
    provenance: Provenance | None = None
    # embedding (vector) and tsv (full-text) are added in Postgres, not here.


class Standard(BaseModel):
    """One source document. Each Clause points up to it via standard_id."""

    standard_id: str                       # canonical, normalized id (see PLAN 6.1 lever 3)
    title: str
    publisher: str
    version: str | None = None
    status: str | None = None              # e.g. current | superseded | draft
    jurisdiction: str | None = None
    effective_date: str | None = None
    supersedes: str | None = None          # standard_id of the doc this replaces
    source_url: str | None = None
