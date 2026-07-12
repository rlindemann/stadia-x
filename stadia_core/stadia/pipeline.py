"""End-to-end orchestrator: parse -> extract -> emit -> (reason) -> (load).

  stadia --input doc.pdf --corpus my-standard --type sx:Clause --prefix C --out out.ttl
  stadia --input notes.md --format text --corpus notes            # offline, no API key
  stadia --input doc.pdf --corpus my-standard --llm --reason --load
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .emit import entities_to_graph
from .extract import ExtractContext, LLMExtractor, PassthroughExtractor
from .load import Fuseki
from .parse import get_parser


def main() -> None:
    ap = argparse.ArgumentParser(description="stadia-core ingestion pipeline")
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--format", default="pdf", choices=["pdf", "text", "jsonl"])
    ap.add_argument("--org", default="stadia")
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--type", default="sx:Fragment")
    ap.add_argument("--prefix", default="F")
    ap.add_argument("--out", type=Path, default=Path("out.ttl"))
    ap.add_argument("--llm", action="store_true", help="Schema-driven LLM extraction (needs ANTHROPIC_API_KEY)")
    ap.add_argument("--reason", action="store_true", help="Materialise the OWL-RL closure")
    ap.add_argument("--load", action="store_true", help="Load the result into Fuseki")
    args = ap.parse_args()

    parser = get_parser(args.format)
    extractor = LLMExtractor() if args.llm else PassthroughExtractor()
    ctx = ExtractContext(org=args.org, corpus=args.corpus, entity_type=args.type, prefix=args.prefix)

    entities = []
    for seg in parser.segments(args.input):
        entities.extend(extractor.extract(seg, ctx))
    print(f"Extracted {len(entities)} entities from {args.input.name}")

    g = entities_to_graph(entities)
    if args.reason:
        from .reason import expand

        expand(g)
    g.serialize(str(args.out), format="turtle")
    print(f"Wrote {len(g)} triples -> {args.out}")

    if args.load:
        fk = Fuseki()
        if not fk.ping():
            raise SystemExit("Fuseki not reachable — check STADIA_FUSEKI_BASE / password")
        fk.clear()
        fk.upload(args.out)
        print(f"Loaded into Fuseki: {fk.count()} triples total")


if __name__ == "__main__":
    main()
