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
  source_url     text,                       -- blob URL of the source PDF
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
  embedding       vector(1024),               -- clause-text embedding
  tsv             tsvector generated always as (to_tsvector('english', verbatim_text)) stored,
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

-- Indexes: HNSW cosine for semantic, GIN for full-text, plain for facets.
create index if not exists clauses_embedding_idx on clauses using hnsw (embedding vector_cosine_ops);
create index if not exists clause_questions_embedding_idx on clause_questions using hnsw (embedding vector_cosine_ops);
create index if not exists clauses_tsv_idx on clauses using gin (tsv);
create index if not exists clauses_standard_idx on clauses (standard_id);
create index if not exists clauses_obligation_idx on clauses (obligation_type);
create index if not exists clause_questions_clause_idx on clause_questions (clause_id);
