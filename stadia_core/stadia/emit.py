"""rdflib emitter: entities -> RDF graph. Replaces DeixOn's hand-built f-string Turtle.

No manual escaping, guaranteed-valid Turtle, round-trippable.
"""

from __future__ import annotations

from rdflib import RDF, RDFS, Graph, Literal, Namespace, URIRef
from rdflib.namespace import DCTERMS, SKOS, XSD

from .config import settings
from .model import Entity

SX = Namespace(settings.ontology_base)


def _term(curie: str) -> URIRef:
    if curie.startswith("http"):
        return URIRef(curie)
    if ":" in curie:
        return SX[curie.split(":", 1)[1]]
    return SX[curie]


def _lit(v: object) -> Literal:
    if isinstance(v, bool):
        return Literal(v, datatype=XSD.boolean)
    if isinstance(v, int):
        return Literal(v, datatype=XSD.integer)
    if isinstance(v, float):
        return Literal(v, datatype=XSD.decimal)
    return Literal(str(v))


def new_graph() -> Graph:
    g = Graph()
    g.bind("sx", SX)
    g.bind("skos", SKOS)
    g.bind("dct", DCTERMS)
    g.bind("rdfs", RDFS)
    g.bind("xsd", XSD)
    return g


def add_entity(g: Graph, e: Entity) -> None:
    s = URIRef(e.uri)
    g.add((s, RDF.type, _term(e.type)))
    if e.label:
        g.add((s, RDFS.label, Literal(e.label)))
    if e.verbatim_text:
        g.add((s, SX.verbatimText, Literal(e.verbatim_text)))
    if e.part_of:
        g.add((s, SX.partOf, URIRef(e.part_of)))
    if e.anchor:
        g.add((s, DCTERMS.source, Literal(e.anchor.dct_source())))
        if e.anchor.page is not None:
            g.add((s, SX.page, Literal(e.anchor.page, datatype=XSD.integer)))
        if e.anchor.file_page is not None:
            g.add((s, SX.filePage, Literal(e.anchor.file_page, datatype=XSD.integer)))
    if e.prov:
        g.add((s, SX.extractedBy, Literal(e.prov.extracted_by)))
        g.add((s, SX.extractionDate, Literal(e.prov.extracted_on, datatype=XSD.date)))
        g.add((s, SX.extractionConfidence, Literal(e.prov.confidence)))
    for p, v in e.props.items():
        g.add((s, SX[p], _lit(v)))
    for p, uris in e.links.items():
        for u in uris:
            g.add((s, SX[p], URIRef(u)))


def entities_to_graph(entities: list[Entity]) -> Graph:
    g = new_graph()
    for e in entities:
        add_entity(g, e)
    return g
