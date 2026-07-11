# Stadia-X

Ingest a corpus of policy documents and standards, extract them into structured
knowledge with provenance down to the clause / paragraph, and query precisely by
standard, clause, and meaning.

## Notes

- Always use `uv run python` — never bare `python`
- LLM extraction uses the Anthropic API; keys live in `.env` (git-ignored, see `.env.example`)
- No audio / transcription stack — this is a written-document corpus, not podcasts.
  No Whisper, pyannote, CUDA, ffmpeg, or `huggingface-hub` pin.

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working documentation

All planning and execution docs live in `docs/`. Review `docs/PLAN.md` before proceeding.

`docs/` also holds two source blueprints distilled from prior repos, each a
different valid approach to this problem:
- `STADIA_X_REPLICATION.md` — the retrieval-first approach (LLM extraction harness
  + hybrid semantic/lexical search over Postgres/pgvector).
- `REPLICATION_GUIDE_stadia-x.md` — the semantic-web approach (versioned URIs,
  OWL ontology, SPARQL triplestore, SHACL validation, provenance golden thread).

`PLAN.md` reconciles the two into what Stadia-X actually builds.

## YOLO MODE

claude --dangerously-skip-permissions
