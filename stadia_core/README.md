# stadia-core

A source-agnostic pipeline for turning policy documents and standards into a queryable
knowledge graph: **parse → extract → emit RDF → (reason) → (validate) → load → query**.

This is the generalized rewrite of the DeixOn workflow (see
`../REPLICATION_GUIDE_stadia-x.md`, section 12). Where DeixOn had one bespoke script per
document and built Turtle by hand, this handles any document type by **configuration** and
generates RDF with rdflib. Copy this whole folder into the stadia-x repo as a starting point.

## Layout

```
stadia/
  config.py     # one settings object (STADIA_* env / .env) — no hardcoded endpoints
  model.py      # Entity / Segment / SourceAnchor / Provenance — the single data model
  uri.py        # central versioned-URI minter (identity policy in one place)
  parse.py      # source -> Segments: TextParser, JsonlParser, PdfHeadingParser
  extract.py    # Segment -> Entities: PassthroughExtractor, LLMExtractor, calibration_gate
  emit.py       # Entities -> rdflib Graph (valid Turtle, round-trippable)
  reason.py     # optional OWL-RL closure (no hand-listed subclass INSERTs)
  load.py       # Fuseki loader over the Graph Store Protocol (clear-then-load)
  validate.py   # SHACL + SPARQL competency checks (both return bool for CI)
  retrieve.py   # hybrid semantic + structural retrieval (the net-new capability)
  query.py      # SPARQL CLI
  pipeline.py   # end-to-end orchestrator (`stadia` command)
ontology/stadia.ttl        # starter upper ontology (S5) — rename sx: to your namespace
shapes/stadia_shapes.ttl   # starter SHACL: every fragment needs verbatim text + source
queries/example.rq         # sample query
examples/sample.md         # sample input for the offline smoke test
fuseki/ + Dockerfile       # single-container Fuseki (TDB2) deploy, seed-if-empty
```

## Install

```bash
uv venv && source .venv/bin/activate        # or: python -m venv .venv
uv pip install -e ".[all]"                  # or pick extras: .[pdf,llm,shacl,reason,vector]
cp .env.example .env                        # set STADIA_FUSEKI_PASSWORD, ANTHROPIC_API_KEY
```

Extras are optional and lazily imported: `pdf` (PyMuPDF), `llm` (Anthropic), `shacl`
(pyshacl), `reason` (owlrl), `vector` (numpy). The core imports with just rdflib + requests.

## Quickstart — offline, no API key

```bash
stadia --input examples/sample.md --format text --corpus demo --type sx:Fragment --out out.ttl
```
Produces valid Turtle with URIs, source anchors, and provenance. That is the full
parse → extract → emit path with the passthrough extractor.

## With LLM extraction, reasoning, and load

```bash
# 1. start the graph DB
docker build -t stadia . && docker run -e FUSEKI_PASSWORD=$STADIA_FUSEKI_PASSWORD -p 3030:3030 stadia

# 2. ingest a real PDF: schema-driven extraction -> reasoning -> load
stadia --input mystandard.pdf --corpus my-standard --type sx:Clause --prefix C \
       --llm --reason --load

# 3. query
stadia-query --query queries/example.rq
```

## Validate

```python
from rdflib import Graph
from stadia.validate import shacl_validate, competency

data = Graph().parse("out.ttl"); shapes = Graph().parse("shapes/stadia_shapes.ttl")
ok, report = shacl_validate(data, shapes)          # structural conformance
competency(data, [                                  # competency questions
    ("has-fragments", "SELECT (COUNT(?f) AS ?n) WHERE { ?f a <https://stadia.example/ontology#Fragment> }", 1, ">="),
])
```
(SHACL `targetClass sx:Fragment` matches subclass instances only after `reason.expand`,
which materialises the subclass→Fragment types.)

## Hybrid retrieval (precise paragraph search)

The one capability DeixOn lacks. Embed each fragment at load, search semantically, then let
the graph supply exact citation + provenance:

```python
from stadia.retrieve import InMemoryIndex, Retriever

index = InMemoryIndex()
for e in entities:                                  # at load time
    index.upsert(e.uri, embed(e.verbatim_text))     # embed = your model (voyage/openai/ST)

r = Retriever(index=index, embed=embed)
hits = r.retrieve("minimum floor area for dwellings", k=10)   # -> uri, text, source, parent
```
Swap `InMemoryIndex` for pgvector or Qdrant in production — same two-method interface. If
you prefer one store for graph + vector + full-text, use Postgres + Apache AGE + pgvector +
tsvector (see guide section 10).

## What to change for your corpus

1. `STADIA_ONTOLOGY_BASE` / `STADIA_INSTANCE_BASE` in `.env` (your real domain).
2. `ontology/stadia.ttl` — your classes/properties, grown from competency questions.
3. `extract.DEFAULT_SCHEMA` / `PROMPT` — the JSON schema for your entity shape.
4. Add a parser in `parse.py` only for genuinely irregular source formats.
5. Keep the calibration gate (`extract.calibration_gate`) in front of any LLM classification.

## Build order (from the guide)

Pick 2-3 representative documents + one competency question each → do S1–S4 vocabulary and
taxonomy → run extraction to Turtle → validate → load + add a vector index → query library →
Dockerise. Do not write OWL (S5) until S1–S4 are clean.
