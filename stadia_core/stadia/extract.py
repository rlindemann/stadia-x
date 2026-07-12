"""Extractors: Segment -> Entities. Passthrough (no LLM) and schema-driven LLM variants."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol

from .config import settings
from .model import Entity, Provenance, Segment
from .uri import mint, slug


@dataclass
class ExtractContext:
    org: str
    corpus: str
    entity_type: str = "sx:Fragment"
    version: str = "v1"
    prefix: str = "F"
    tool_name: str = "stadia-core/extract v0.1"


class Extractor(Protocol):
    def extract(self, seg: Segment, ctx: ExtractContext) -> list[Entity]: ...


class PassthroughExtractor:
    """No LLM: each segment becomes one Entity verbatim. Runs offline for testing and
    is the right choice when the source is already clean/structured."""

    def extract(self, seg: Segment, ctx: ExtractContext) -> list[Entity]:
        local = seg.hint.get("code") or seg.hint.get("id") or slug(seg.text[:40]) or "seg"
        return [
            Entity(
                uri=mint(ctx.prefix, ctx.org, ctx.corpus, local, ctx.version),
                type=ctx.entity_type,
                verbatim_text=seg.text,
                label=str(seg.hint.get("heading", ""))[:120],
                anchor=seg.anchor,
                prov=Provenance(ctx.tool_name, date.today(), "verbatim"),
            )
        ]


DEFAULT_SCHEMA = {
    "type": "object",
    "properties": {
        "entities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "local_id": {"type": "string"},
                    "label": {"type": "string"},
                    "verbatim_text": {"type": "string"},
                    "links": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["local_id", "verbatim_text"],
            },
        }
    },
    "required": ["entities"],
}

PROMPT = (
    "Extract structured entities from the passage below. "
    "verbatim_text MUST be character-faithful — do not paraphrase, summarise, or invent. "
    "Return one entity per distinct clause / paragraph / requirement.\n\nPASSAGE:\n{text}"
)


class LLMExtractor:
    """Schema-driven Anthropic structured output. One extractor for all document types;
    the JSON schema is the only thing that varies per corpus. Structured output removes
    the ```json fence-stripping and _failed_*.txt fallbacks DeixOn needed."""

    def __init__(self, schema: dict | None = None, model: str | None = None):
        self.schema = schema or DEFAULT_SCHEMA
        self.model = model or settings.model

    def extract(self, seg: Segment, ctx: ExtractContext) -> list[Entity]:
        from anthropic import Anthropic

        client = Anthropic()
        tool = {
            "name": "emit_entities",
            "description": "Return the extracted entities.",
            "input_schema": self.schema,
        }
        msg = client.messages.create(
            model=self.model,
            max_tokens=8000,
            tools=[tool],
            tool_choice={"type": "tool", "name": "emit_entities"},
            messages=[{"role": "user", "content": PROMPT.format(text=seg.text[:20000])}],
        )
        data = next((b.input for b in msg.content if b.type == "tool_use"), {"entities": []})
        out: list[Entity] = []
        for item in data.get("entities", []):
            links = item.get("links") or []
            out.append(
                Entity(
                    uri=mint(ctx.prefix, ctx.org, ctx.corpus, item["local_id"], ctx.version),
                    type=ctx.entity_type,
                    verbatim_text=item.get("verbatim_text", ""),
                    label=item.get("label", ""),
                    anchor=seg.anchor,
                    prov=Provenance(ctx.tool_name, date.today(), "verbatim"),
                    links=(
                        {"cites": [mint(ctx.prefix, ctx.org, ctx.corpus, c, ctx.version) for c in links]}
                        if links
                        else {}
                    ),
                )
            )
        return out


def calibration_gate(cases: list[dict], classify, threshold: float = 0.95) -> float:
    """Run a classifier over hand-labelled ground truth; return accuracy.

    cases = [{"text": ..., "expected": ...}]; classify(text) -> label.
    Mirrors DeixOn's Gate 2: do not run the full corpus until this passes.
    """
    correct = 0
    for c in cases:
        got = classify(c["text"])
        ok = got == c["expected"]
        correct += ok
        print(f"  [{'ok' if ok else 'XX'}] expected={c['expected']!s:14} got={got!s:14}")
    acc = correct / len(cases) if cases else 0.0
    verdict = "PASS" if acc >= threshold else "FAIL"
    print(f"\nAccuracy: {acc * 100:.0f}%  ({verdict} @ {threshold * 100:.0f}%)")
    return acc
