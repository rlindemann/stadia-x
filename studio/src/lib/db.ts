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

// Public surfaces hide standards still in admin review. Review status lives in
// standards.meta (jsonb) so no schema migration is needed; a missing/absent flag
// means published, so the existing corpus is unaffected. `s` must alias standards.
const PUBLISHED = `coalesce(s.meta->>'review_status','published') <> 'pending'`;

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
  standard_status: string | null;
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
  score: number; // fused RRF score
  dense_rnk: number | null; // rank from semantic search over clause text
  qdense_rnk: number | null; // rank from semantic search over anticipated questions
  lex_rnk: number | null; // rank from full-text search
  dense_sim: number; // cosine similarity to clause text (0-1)
  q_sim: number | null; // cosine similarity to best matching question (0-1)
  lex_score: number; // full-text ts_rank (0 if no lexical match)
  matched_question: string | null;
};

export type SearchFilters = {
  obligation?: string[]; // requirement|recommendation|permission|informative
  status?: string[]; // standards.status, e.g. Current|Superseded
  publisher?: string[];
  standardId?: string[];
  currentOnly?: boolean; // convenience: exclude Superseded editions
};

// Hybrid search: dense (clause text) + dense (questions) + lexical, fused with
// Reciprocal Rank Fusion (k=60). Each dense subquery uses its HNSW index.
// Filters are applied server-side inside every candidate CTE. Superseded
// editions are de-ranked (score x0.6) rather than hidden.
//   $1 = query vector, $2 = expanded lexical query, then filter params, then limit.
export async function hybridSearch(
  lexQuery: string,
  embedding: number[],
  limit = 20,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const vec = `[${embedding.join(",")}]`;
  const params: unknown[] = [vec, lexQuery];
  const conds: string[] = [];

  if (filters.obligation?.length) {
    params.push(filters.obligation);
    conds.push(`c.obligation_type = any($${params.length})`);
  }
  if (filters.status?.length) {
    params.push(filters.status);
    conds.push(`s.status = any($${params.length})`);
  } else if (filters.currentOnly) {
    conds.push(`s.status is distinct from 'Superseded'`);
  }
  if (filters.publisher?.length) {
    params.push(filters.publisher);
    conds.push(`s.publisher = any($${params.length})`);
  }
  if (filters.standardId?.length) {
    params.push(filters.standardId);
    conds.push(`c.standard_id = any($${params.length})`);
  }
  const filterSql = conds.length ? " and " + conds.join(" and ") : "";
  params.push(limit);
  const limitParam = `$${params.length}`;

  const sql = `
with dense as (
  select clause_id, row_number() over (order by dist) as rnk from (
    select c.id as clause_id, c.embedding <=> $1::vector as dist
    from clauses c join standards s on s.id = c.standard_id
    where ${PUBLISHED}${filterSql}
    order by c.embedding <=> $1::vector limit 50
  ) t
),
qd as (
  select clause_id, min(rnk) as rnk from (
    select clause_id, row_number() over (order by dist) as rnk from (
      select cq.clause_id, cq.embedding <=> $1::vector as dist
      from clause_questions cq
      join clauses c on c.id = cq.clause_id
      join standards s on s.id = c.standard_id
      where ${PUBLISHED}${filterSql}
      order by cq.embedding <=> $1::vector limit 80
    ) t
  ) u group by clause_id
),
lex as (
  select clause_id, row_number() over (order by lrank desc) as rnk from (
    select c.id as clause_id, ts_rank(c.tsv, websearch_to_tsquery('english', $2)) as lrank
    from clauses c join standards s on s.id = c.standard_id
    where c.tsv @@ websearch_to_tsquery('english', $2) and ${PUBLISHED}${filterSql}
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
select c.id, c.standard_id, s.title as standard_title, s.status as standard_status, s.publisher, c.clause_path, c.heading_trail,
       c.page, c.pdf_file_page, c.obligation_type, c.normativity, c.verbatim_text,
       c.defined_terms, c.uri, s.source_url,
       f.score::float8 as score, f.dense_rnk, f.qdense_rnk, f.lex_rnk,
       (1 - (c.embedding <=> $1::vector))::float8 as dense_sim,
       ts_rank(c.tsv, websearch_to_tsquery('english', $2))::float8 as lex_score,
       bq.question as matched_question,
       bq.q_sim
from fused f
join clauses c on c.id = f.clause_id
join standards s on s.id = c.standard_id
left join lateral (
  select question, (1 - (embedding <=> $1::vector))::float8 as q_sim
  from clause_questions cq
  where cq.clause_id = c.id order by cq.embedding <=> $1::vector limit 1
) bq on true
order by f.score * case when s.status = 'Superseded' then 0.6 else 1 end desc
limit ${limitParam}
`;
  return query<SearchHit>(sql, params);
}

export type Facets = {
  publishers: string[];
  standards: { id: string; title: string }[];
  obligations: string[];
  statuses: string[];
};

// Facet options for the search filter UI, derived from what is actually loaded.
export async function listFacets(): Promise<Facets> {
  const [pubs, stds, obs, sts] = await Promise.all([
    query<{ publisher: string }>(
      `select distinct publisher from standards s where publisher is not null and ${PUBLISHED} order by publisher`,
      [],
    ),
    query<{ id: string; title: string }>(
      `select id, title from standards s where ${PUBLISHED} order by status = 'Superseded', title`,
      [],
    ),
    query<{ obligation_type: string }>(
      `select distinct obligation_type from clauses where obligation_type is not null order by obligation_type`,
      [],
    ),
    query<{ status: string }>(
      `select distinct status from standards where status is not null order by status`,
      [],
    ),
  ]);
  return {
    publishers: pubs.map((r) => r.publisher),
    standards: stds,
    obligations: obs.map((r) => r.obligation_type),
    statuses: sts.map((r) => r.status),
  };
}

export type StandardRow = {
  id: string;
  title: string;
  publisher: string | null;
  version: string | null;
  status: string | null;
  thumb_url: string | null;
  superseded_by: string | null; // id of the newer edition that replaces this one
  superseded_by_title: string | null;
  clause_count: number;
};

export function listStandards(): Promise<StandardRow[]> {
  return query<StandardRow>(
    `select s.id, s.title, s.publisher, s.version, s.status, s.thumb_url,
            n.id as superseded_by, n.title as superseded_by_title,
            (select count(*)::int from clauses c where c.standard_id = s.id) as clause_count
     from standards s
     left join standards n on n.supersedes = s.id
     where ${PUBLISHED}
     order by s.status = 'Superseded', s.title`,
    [],
  );
}

export type AdminStandardRow = {
  id: string;
  title: string;
  publisher: string | null;
  status: string | null;
  review_status: string;
  clause_count: number;
  source_url: string | null;
};

// Admin view: every standard including those pending review.
export function listAdminStandards(): Promise<AdminStandardRow[]> {
  return query<AdminStandardRow>(
    `select s.id, s.title, s.publisher, s.status,
            coalesce(s.meta->>'review_status','published') as review_status, s.source_url,
            (select count(*)::int from clauses c where c.standard_id = s.id) as clause_count
     from standards s order by (coalesce(s.meta->>'review_status','published')='pending') desc, s.title`,
    [],
  );
}

export async function createPendingStandard(
  id: string,
  title: string,
  publisher: string | null,
  supersedes: string | null,
): Promise<void> {
  await query(
    `insert into standards (id, title, publisher, supersedes, meta)
     values ($1, $2, $3, $4, jsonb_build_object('review_status','pending'))
     on conflict (id) do update set title = excluded.title, publisher = excluded.publisher,
       supersedes = excluded.supersedes,
       meta = standards.meta || jsonb_build_object('review_status','pending')`,
    [id, title, publisher, supersedes],
  );
}

export async function setReviewStatus(id: string, status: "pending" | "published"): Promise<void> {
  await query(
    `update standards set meta = meta || jsonb_build_object('review_status', $2::text) where id = $1`,
    [id, status],
  );
}

export async function deleteStandard(id: string): Promise<void> {
  await query(`delete from standards where id = $1`, [id]);
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
     where ${PUBLISHED}
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

export type EditionClause = {
  id: number;
  clause_path: string;
  heading_trail: string;
  obligation_type: string;
  page: number;
  pdf_file_page: number;
  verbatim_text: string;
};

export type EditionPair = {
  current: { id: string; title: string };
  previous: { id: string; title: string };
  current_clauses: EditionClause[];
  previous_clauses: EditionClause[];
};

// Standard pairs linked by supersession, for the edition-diff picker.
export function listEditionPairs(): Promise<{ current_id: string; current_title: string; previous_id: string; previous_title: string }[]> {
  return query(
    `select n.id as current_id, n.title as current_title, o.id as previous_id, o.title as previous_title
     from standards n join standards o on n.supersedes = o.id
     order by n.title`,
    [],
  );
}

// Clauses of a superseding edition and the edition it replaces, for a clause-level diff.
export async function getEditionPair(currentId: string): Promise<EditionPair | null> {
  const std = await query<{ current_id: string; current_title: string; previous_id: string; previous_title: string }>(
    `select n.id as current_id, n.title as current_title, o.id as previous_id, o.title as previous_title
     from standards n join standards o on n.supersedes = o.id
     where n.id = $1`,
    [currentId],
  );
  const pair = std[0];
  if (!pair) return null;

  const clausesFor = (id: string) =>
    query<EditionClause>(
      `select id, clause_path, heading_trail, obligation_type, page, pdf_file_page, verbatim_text
       from clauses where standard_id = $1 order by pdf_file_page, id`,
      [id],
    );
  const [current_clauses, previous_clauses] = await Promise.all([
    clausesFor(pair.current_id),
    clausesFor(pair.previous_id),
  ]);

  return {
    current: { id: pair.current_id, title: pair.current_title },
    previous: { id: pair.previous_id, title: pair.previous_title },
    current_clauses,
    previous_clauses,
  };
}

export type ClauseRef = {
  raw: string | null;
  reference_type: string | null;
  to_standard: string | null;
  to_standard_title: string | null;
  to_clause: number | null;
  to_clause_path: string | null;
};

export type ClauseDetail = {
  id: number;
  standard_id: string;
  standard_title: string;
  publisher: string | null;
  standard_status: string | null;
  source_url: string | null;
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
  questions: string[];
  references: ClauseRef[];
  term_defs: { term: string; defined_in_clause: number | null; standard_id: string | null }[];
  prev: { id: number; clause_path: string } | null;
  next: { id: number; clause_path: string } | null;
};

// Full clause permalink payload: the clause, its provenance, anticipated
// questions, resolved references, where its defined terms are defined, and the
// neighbouring clauses in the same document.
export async function getClauseDetail(id: number): Promise<ClauseDetail | null> {
  const rows = await query<Omit<ClauseDetail, "references" | "term_defs" | "prev" | "next">>(
    `select c.id, c.standard_id, s.title as standard_title, s.publisher, s.status as standard_status,
            s.source_url, c.clause_path, c.heading_trail, c.page, c.pdf_file_page, c.block_type,
            c.obligation_type, c.normativity, c.verbatim_text, c.defined_terms, c.uri,
            coalesce((select array_agg(q.question order by q.id)
                      from clause_questions q where q.clause_id = c.id), '{}') as questions
     from clauses c join standards s on s.id = c.standard_id
     where c.id = $1`,
    [id],
  );
  const base = rows[0];
  if (!base) return null;

  const [references, term_defs, prev, next] = await Promise.all([
    query<ClauseRef>(
      `select r.raw, r.reference_type, r.to_standard, ts.title as to_standard_title,
              r.to_clause, tc.clause_path as to_clause_path
       from refs r
       left join clauses tc on tc.id = r.to_clause
       left join standards ts on ts.id = r.to_standard
       where r.from_clause = $1 order by r.id`,
      [id],
    ),
    base.defined_terms.length
      ? query<{ term: string; defined_in_clause: number | null; standard_id: string | null }>(
          `select distinct on (t.term) t.term, t.defined_in_clause, t.standard_id
           from terms t where t.term = any($1) order by t.term, t.defined_in_clause`,
          [base.defined_terms],
        )
      : Promise.resolve([]),
    query<{ id: number; clause_path: string }>(
      `select id, clause_path from clauses
       where standard_id = $1 and (pdf_file_page, id) < ($2, $3)
       order by pdf_file_page desc, id desc limit 1`,
      [base.standard_id, base.pdf_file_page, id],
    ),
    query<{ id: number; clause_path: string }>(
      `select id, clause_path from clauses
       where standard_id = $1 and (pdf_file_page, id) > ($2, $3)
       order by pdf_file_page, id limit 1`,
      [base.standard_id, base.pdf_file_page, id],
    ),
  ]);

  return { ...base, references, term_defs, prev: prev[0] ?? null, next: next[0] ?? null };
}

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
