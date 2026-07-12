import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL!);

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
  query: string,
  embedding: number[],
  limit = 20,
): Promise<SearchHit[]> {
  const vec = `[${embedding.join(",")}]`;
  const res: unknown = await sql.query(SEARCH_SQL, [vec, query, limit]);
  const rows = Array.isArray(res) ? res : (res as { rows: unknown[] }).rows;
  return rows as SearchHit[];
}
