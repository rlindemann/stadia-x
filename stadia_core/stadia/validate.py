"""Dual validation: SHACL structural conformance + SPARQL competency questions.

Both return a boolean so they drop straight into CI.
"""

from __future__ import annotations

from rdflib import Graph


def shacl_validate(data: Graph, shapes: Graph) -> tuple[bool, str]:
    from pyshacl import validate

    conforms, _, text = validate(
        data, shacl_graph=shapes, inference="none", allow_warnings=True
    )
    return conforms, text


def competency(g: Graph, checks: list[tuple[str, str, int, str]]) -> bool:
    """checks: (id, sparql-returning-single-count, expected, op in {==, >=, >}). All must pass."""
    ok = True
    for cid, sparql, expected, op in checks:
        val = int(list(g.query(sparql))[0][0])
        passed = {"==": val == expected, ">=": val >= expected, ">": val > expected}[op]
        ok = ok and passed
        print(f"  [{'PASS' if passed else 'FAIL'}] {cid}: {val} {op} {expected}")
    return ok
