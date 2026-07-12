"""SPARQL query CLI. Reads STADIA_* config for the endpoint — nothing hardcoded.

  stadia-query --sparql "SELECT ?s WHERE { ?s a sx:Fragment } LIMIT 5"
  stadia-query --query queries/example.rq
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .config import settings
from .load import Fuseki

PREFIXES = f"""
PREFIX sx:  <{settings.ontology_base}>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
"""


def _print_table(rows: list[dict]) -> None:
    if not rows:
        print("(no results)")
        return
    cols = list(rows[0].keys())
    widths = {c: max(len(c), max(len(r.get(c, {}).get("value", "")) for r in rows)) for c in cols}
    print(" | ".join(c.ljust(widths[c]) for c in cols))
    print("-" * (sum(widths.values()) + 3 * (len(cols) - 1)))
    for r in rows:
        print(" | ".join(r.get(c, {}).get("value", "").ljust(widths[c]) for c in cols))
    print(f"\n{len(rows)} row(s)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Run SPARQL against the stadia Fuseki endpoint")
    ap.add_argument("--query", type=Path, help="Path to a .rq file")
    ap.add_argument("--sparql", help="Inline SPARQL string")
    args = ap.parse_args()

    sparql = args.query.read_text(encoding="utf-8") if args.query else args.sparql
    if not sparql:
        sparql = "SELECT (COUNT(*) AS ?triples) WHERE { ?s ?p ?o }"
    _print_table(Fuseki().query(PREFIXES + sparql))


if __name__ == "__main__":
    main()
