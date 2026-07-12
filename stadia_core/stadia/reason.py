"""Optional inference: materialise the RDFS/OWL-RL closure before load, so you never
hand-list subclass INSERTs (DeixOn's 04_load_fuseki.py had ~17 of them)."""

from __future__ import annotations

from rdflib import Graph


def expand(g: Graph) -> Graph:
    """Add a class to the ontology and its instances inherit superclass types for free."""
    import owlrl

    owlrl.DeductiveClosure(owlrl.RDFS_OWLRL_Semantics).expand(g)
    return g
