import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Lazy client so the build never touches DATABASE_URL at import time.
let _sql: NeonQueryFunction<false, false> | null = null;
function db() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

async function query<T>(text: string, params: unknown[]): Promise<T[]> {
  const res: unknown = await db().query(text, params);
  return (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as T[];
}

// Embed a search query with Voyage (same model + dimension used at load time).
export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [text],
      model: "voyage-3.5",
      input_type: "query",
      output_dimension: 1024,
    }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding as number[];
}

export type SearchHit = {
  id: number;
  standard_id: string;
  standard_title: string;
  publisher: string | null;
  clause_path: string;
  heading_trail: string;
  page: number;
  pdf_file_page: number;
  obligation_type: string;
  normativity: string;
  verbatim_text: string;
  defined_terms: string[];
  uri: string | null;
  source_url: string | null;
  score: number;
  dense_rnk: number | null; // rank from semantic search over clause text
  qdense_rnk: number | null; // rank from semantic search over anticipated questions
  lex_rnk: number | null; // rank from full-text search
  matched_question: string | null;
};

// Hybrid search: dense (clause text) + dense (questions) + lexical, fused with
// Reciprocal Rank Fusion (k=60). Each dense subquery uses its HNSW index.
const SEARCH_SQL = `
with dense as (
  select clause_id, row_number() over (order by dist) as rnk from (
    select id as clause_id, embedding <=> $1::vector as dist
    from clauses order by embedding <=> $1::vector limit 50
  ) t
),
qd as (
  select clause_id, min(rnk) as rnk from (
    select clause_id, row_number() over (order by dist) as rnk from (
      select clause_id, embedding <=> $1::vector as dist
      from clause_questions order by embedding <=> $1::vector limit 80
    ) t
  ) u group by clause_id
),
lex as (
  select clause_id, row_number() over (order by lrank desc) as rnk from (
    select id as clause_id, ts_rank(tsv, websearch_to_tsquery('english', $2)) as lrank
    from clauses where tsv @@ websearch_to_tsquery('english', $2)
    order by lrank desc limit 50
  ) t
),
ids as (
  select clause_id from dense union select clause_id from qd union select clause_id from lex
),
fused as (
  select i.clause_id,
    coalesce(1.0/(60+d.rnk),0) + coalesce(1.0/(60+q.rnk),0) + coalesce(1.0/(60+l.rnk),0) as score,
    d.rnk as dense_rnk, q.rnk as qdense_rnk, l.rnk as lex_rnk
  from ids i
  left join dense d on d.clause_id = i.clause_id
  left join qd q on q.clause_id = i.clause_id
  left join lex l on l.clause_id = i.clause_id
)
select c.id, c.standard_id, s.title as standard_title, s.publisher, c.clause_path, c.heading_trail,
       c.page, c.pdf_file_page, c.obligation_type, c.normativity, c.verbatim_text,
       c.defined_terms, c.uri, s.source_url,
       f.score::float8 as score, f.dense_rnk, f.qdense_rnk, f.lex_rnk,
       bq.question as matched_question
from fused f
join clauses c on c.id = f.clause_id
join standards s on s.id = c.standard_id
left join lateral (
  select question from clause_questions cq
  where cq.clause_id = c.id order by cq.embedding <=> $1::vector limit 1
) bq on true
order by f.score desc
limit $3
`;

export async function hybridSearch(
  queryText: string,
  embedding: number[],
  limit = 20,
): Promise<SearchHit[]> {
  const vec = `[${embedding.join(",")}]`;
  return query<SearchHit>(SEARCH_SQL, [vec, queryText, limit]);
}

export type StandardRow = {
  id: string;
  title: string;
  publisher: string | null;
  version: string | null;
  status: string | null;
  thumb_url: string | null;
  clause_count: number;
};

export function listStandards(): Promise<StandardRow[]> {
  return query<StandardRow>(
    `select s.id, s.title, s.publisher, s.version, s.status, s.thumb_url,
            (select count(*)::int from clauses c where c.standard_id = s.id) as clause_count
     from standards s order by s.title`,
    [],
  );
}

export type TermRow = {
  term: string;
  definition: string;
  clause_path: string;
  standard_title: string;
  standard_id: string;
};

export function listTerms(): Promise<TermRow[]> {
  // One row per term, preferring the actual definition clause when a term was
  // tagged on more than one clause.
  return query<TermRow>(
    `select distinct on (t.term)
            t.term, c.verbatim_text as definition, c.clause_path,
            s.title as standard_title, s.id as standard_id
     from terms t
     join clauses c on c.id = t.defined_in_clause
     join standards s on s.id = t.standard_id
     order by t.term, (c.block_type = 'definition') desc, c.clause_path`,
    [],
  );
}

export type DocRow = {
  id: string;
  title: string;
  source_url: string | null;
  clause_count: number;
};

export function listDocuments(): Promise<DocRow[]> {
  return query<DocRow>(
    `select s.id, s.title, s.source_url,
            (select count(*)::int from clauses c where c.standard_id = s.id) as clause_count
     from standards s order by s.title`,
    [],
  );
}

export async function standardSourceUrl(id: string): Promise<string | null> {
  const rows = await query<{ source_url: string | null }>(
    `select source_url from standards where id = $1`,
    [id],
  );
  return rows[0]?.source_url ?? null;
}

export type ReviewClause = {
  id: number;
  clause_path: string;
  heading_trail: string;
  page: number;
  pdf_file_page: number;
  block_type: string;
  obligation_type: string;
  normativity: string;
  verbatim_text: string;
  defined_terms: string[];
  uri: string | null;
  anticipated_questions: string[];
  references: string[];
};

export function listClauses(standardId: string): Promise<ReviewClause[]> {
  return query<ReviewClause>(
    `select c.id, c.clause_path, c.heading_trail, c.page, c.pdf_file_page, c.block_type,
            c.obligation_type, c.normativity, c.verbatim_text, c.defined_terms, c.uri,
            coalesce((select array_agg(q.question order by q.id)
                      from clause_questions q where q.clause_id = c.id), '{}') as anticipated_questions,
            coalesce((select array_agg(r.raw order by r.id)
                      from refs r where r.from_clause = c.id), '{}') as "references"
     from clauses c where c.standard_id = $1
     order by c.pdf_file_page, c.id`,
    [standardId],
  );
}
