-- Stadia-X single-store schema (Postgres + pgvector).
-- One store carries the graph (FK edges), vectors (pgvector), and full-text (tsvector).
-- Embeddings are voyage-3.5 at 1024 dimensions (see ingest/load.py).

create extension if not exists vector;

create table if not exists standards (
  id             text primary key,          -- canonical standard_id
  title          text not null,
  publisher      text,
  version        text,
  status         text,
  jurisdiction   text,
  effective_date text,
  supersedes     text,                       -- standard_id this replaces
  source_url     text,                       -- R2 URL of the source PDF
  thumb_url      text,                       -- R2 URL of the title-page thumbnail
  page_count     int,
  meta           jsonb not null default '{}'
);

create table if not exists clauses (
  id              bigserial primary key,
  standard_id     text not null references standards(id) on delete cascade,
  clause_path     text not null,
  heading_trail   text,
  page            int,                        -- printed page
  pdf_file_page   int,                        -- 0-based PDF page index
  block_type      text,
  obligation_type text,                       -- requirement|recommendation|permission|informative
  normativity     text,                       -- normative|informative
  verbatim_text   text not null,
  defined_terms   text[] not null default '{}',
  uri             text,
  context         text,                       -- LLM-written situating sentence (contextual retrieval)
  embedding       vector(1024),               -- embedding of (context + verbatim_text)
  -- contextual BM25: the situating context is folded into the full-text index too
  tsv             tsvector generated always as (to_tsvector('english', coalesce(context,'') || ' ' || verbatim_text)) stored,
  meta            jsonb not null default '{}'
);

-- Hypothetical Questions index: each anticipated question is its own searchable
-- row pointing back to its clause (query-to-question matching).
create table if not exists clause_questions (
  id         bigserial primary key,
  clause_id  bigint not null references clauses(id) on delete cascade,
  question   text not null,
  embedding  vector(1024)
);

create table if not exists terms (
  id                bigserial primary key,
  term              text not null,
  definition        text,
  defined_in_clause bigint references clauses(id) on delete set null,
  standard_id       text references standards(id) on delete cascade
);

-- FK-linked cross-reference edges ("references" is a reserved word -> refs).
create table if not exists refs (
  id             bigserial primary key,
  from_clause    bigint not null references clauses(id) on delete cascade,
  to_standard    text references standards(id) on delete set null,
  to_clause      bigint references clauses(id) on delete set null,
  reference_type text,
  raw            text                          -- original reference string
);

-- Typed clause knowledge-graph edges for GraphRAG multi-hop traversal
-- (recursive CTEs; no triplestore). Rebuilt by ingest/build_graph.py.
--   reference | supersedes | defines_term | similar
create table if not exists clause_edges (
  src_clause bigint not null references clauses(id) on delete cascade,
  dst_clause bigint not null references clauses(id) on delete cascade,
  edge_type  text   not null,
  weight     real   not null default 1,
  meta       jsonb  not null default '{}',
  primary key (src_clause, dst_clause, edge_type)
);

-- Tables/figures extracted from source PDFs (detected regions rendered to PNG,
-- vision-transcribed, embedded) and attached to the clause they sit under.
-- Populated by ingest/figures.py.
create table if not exists clause_figures (
  id            bigserial primary key,
  clause_id     bigint references clauses(id) on delete cascade,
  standard_id   text not null references standards(id) on delete cascade,
  page          int,
  pdf_file_page int,
  bbox          jsonb,
  kind          text,                       -- table|figure
  image_url     text,                       -- R2 URL of the rendered region
  transcription text,                       -- Claude-vision structured transcription
  embedding     vector(1024),               -- embedding of the transcription
  meta          jsonb not null default '{}'
);

-- APPLIES_TO: one row per (requirement x stadium category) cell of a compliance
-- matrix. Turns the "required per category" tables (which otherwise live only as
-- free text inside clause_figures.transcription) into queryable structure, so
-- "what must a Category B stadium comply with?" is answerable. Populated by
-- ingest/applies_to.py from clause_figures.
create table if not exists clause_applicability (
  id          bigserial primary key,
  standard_id text not null references standards(id) on delete cascade,
  figure_id   bigint references clause_figures(id) on delete cascade,
  clause_id   bigint references clauses(id) on delete set null,  -- best-matched clause for the requirement
  req_ref     text,             -- the row reference, e.g. "15.2.1"
  requirement text not null,    -- the row label / description
  category    text not null,    -- A | B | C | D | E
  value       text,             -- raw cell content ("8", "Min. 4", "mandatory")
  modality    text not null,    -- mandatory | best_practice | non_applicable
  meta        jsonb not null default '{}'
);

-- Indexes: HNSW cosine for semantic, GIN for full-text, plain for facets.
create index if not exists clauses_embedding_idx on clauses using hnsw (embedding vector_cosine_ops);
create index if not exists clause_questions_embedding_idx on clause_questions using hnsw (embedding vector_cosine_ops);
create index if not exists clauses_tsv_idx on clauses using gin (tsv);
create index if not exists clauses_standard_idx on clauses (standard_id);
create index if not exists clauses_obligation_idx on clauses (obligation_type);
create index if not exists clause_questions_clause_idx on clause_questions (clause_id);
create index if not exists clause_edges_src_idx on clause_edges (src_clause);
create index if not exists clause_edges_dst_idx on clause_edges (dst_clause);
create index if not exists clause_applicability_cat_idx on clause_applicability (standard_id, category);
create index if not exists clause_applicability_clause_idx on clause_applicability (clause_id);
