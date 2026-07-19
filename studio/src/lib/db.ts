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
       (f.score
         * case when s.status = 'Superseded' then 0.6 else 1 end
         * case when c.block_type = 'definition' then 0.7 else 1 end)::float8 as score,
       f.dense_rnk, f.qdense_rnk, f.lex_rnk,
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
order by score desc
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

export type GraphNeighbour = {
  id: number;
  clause_path: string;
  standard_id: string;
  standard_title: string;
  standard_status: string | null;
  obligation_type: string;
  page: number;
  pdf_file_page: number;
  source_url: string | null;
  verbatim_text: string;
  edge_type: string; // reference | supersedes | defines_term | similar
  weight: number;
  depth: number;
};

// Multi-hop neighbours of a clause over the typed knowledge graph (recursive CTE).
// One row per (neighbour, edge_type), shallowest/strongest first.
export function getClauseGraph(clauseId: number, depth = 1): Promise<GraphNeighbour[]> {
  return query<GraphNeighbour>(
    `with recursive walk as (
       select e.dst_clause as cid, e.edge_type, e.weight, 1 as depth,
              array[e.src_clause, e.dst_clause] as path
       from clause_edges e where e.src_clause = $1
       union all
       select e.dst_clause, e.edge_type, e.weight, w.depth + 1, w.path || e.dst_clause
       from walk w join clause_edges e on e.src_clause = w.cid
       where w.depth < $2 and e.dst_clause <> all(w.path)
     ),
     best as (
       select distinct on (cid, edge_type) cid, edge_type, weight, depth
       from walk order by cid, edge_type, depth, weight desc
     )
     select c.id, c.clause_path, c.standard_id, s.title as standard_title, s.status as standard_status,
            c.obligation_type, c.page, c.pdf_file_page, s.source_url, c.verbatim_text,
            b.edge_type, b.weight::float8 as weight, b.depth
     from best b
     join clauses c on c.id = b.cid
     join standards s on s.id = c.standard_id
     where ${PUBLISHED}
     order by b.depth, array_position(array['reference','supersedes','defines_term','similar'], b.edge_type), b.weight desc
     limit 80`,
    [clauseId, depth],
  );
}

export type GraphViewNode = {
  id: number;
  parent: number | null; // clause this node was first reached from (null for the seed)
  via: string | null; // edge type that reached it (null for the seed)
  depth: number; // 0 seed, 1 one hop, 2 two hops
  clause_path: string;
  standard_id: string;
  standard_title: string;
  standard_status: string | null;
  obligation_type: string;
  text: string; // verbatim snippet
};

// Nodes + edges for the clause-page graph view: the seed clause plus its typed
// neighbourhood to `depth` hops (recursive CTE). Each non-seed row carries the
// single edge that first reached it (rarer edge types win ties), so the client
// draws the actual traversal tree. The 2-hop fan-out is capped per parent, and
// the 1-hop set capped overall, to keep the picture legible.
export async function getClauseGraphData(
  clauseId: number,
  depth = 2,
): Promise<{ seed: number; nodes: GraphViewNode[] }> {
  const PRIO = `array['reference','supersedes','defines_term','similar']`;
  const nodes = await query<GraphViewNode>(
    `with recursive walk(cid, depth, parent, via, path) as (
       select e.dst_clause, 1, e.src_clause, e.edge_type, array[e.src_clause, e.dst_clause]
       from clause_edges e where e.src_clause = $1
       union all
       select e.dst_clause, w.depth + 1, w.cid, e.edge_type, w.path || e.dst_clause
       from walk w join clause_edges e on e.src_clause = w.cid
       where w.depth < $2 and e.dst_clause <> all(w.path)
     ),
     firstreach as (
       select distinct on (cid) cid, depth, parent, via
       from walk order by cid, depth, array_position(${PRIO}, via)
     ),
     d1 as (
       select cid, depth, parent, via from firstreach where depth = 1
       order by array_position(${PRIO}, via) limit 16
     ),
     d2 as (
       select f.cid, f.depth, f.parent, f.via,
              row_number() over (partition by f.parent
                                 order by array_position(${PRIO}, f.via)) as rn
       from firstreach f join d1 on d1.cid = f.parent
       where f.depth = 2
     ),
     kept as (
       select $1::bigint as cid, 0 as depth, null::bigint as parent, null::text as via
       union all select cid, depth, parent, via from d1
       union all select cid, depth, parent, via from d2 where rn <= 5
     )
     select c.id, k.parent, k.via, k.depth,
            c.clause_path, c.standard_id, s.title as standard_title, s.status as standard_status,
            c.obligation_type, left(c.verbatim_text, 150) as text
     from kept k
     join clauses c on c.id = k.cid
     join standards s on s.id = c.standard_id
     where ${PUBLISHED}
     order by k.depth`,
    [clauseId, depth],
  );
  return { seed: clauseId, nodes };
}

export type GraphNeighbourLite = {
  id: number;
  clause_path: string;
  standard_id: string;
  standard_title: string;
  obligation_type: string;
  text: string;
  edge_type: string;
  weight: number;
};

// Direct (1-hop) typed neighbours of a clause, for on-demand graph expansion.
// One row per neighbour carrying its primary edge (rarer types win), capped so a
// single expansion can't flood the canvas.
export function getClauseNeighbours(clauseId: number): Promise<GraphNeighbourLite[]> {
  const PRIO = `array['reference','supersedes','defines_term','similar']`;
  return query<GraphNeighbourLite>(
    `select distinct on (c.id) c.id, c.clause_path, c.standard_id, s.title as standard_title,
            c.obligation_type, left(c.verbatim_text, 150) as text,
            e.edge_type, e.weight::float8 as weight
     from clause_edges e
     join clauses c on c.id = e.dst_clause
     join standards s on s.id = c.standard_id
     where e.src_clause = $1 and ${PUBLISHED}
     order by c.id, array_position(${PRIO}, e.edge_type), e.weight desc
     limit 40`,
    [clauseId],
  );
}

// GraphRAG expansion: given the seed clauses a query retrieved, pull their
// direct graph neighbours (precise edges first) to widen the answer context
// with clauses the seeds depend on / define / supersede — the multi-hop that
// flat search misses. Returns SearchHit-shaped rows (score 0; they are context,
// not ranked hits).
export function graphExpand(seedIds: number[], limit = 8): Promise<SearchHit[]> {
  if (seedIds.length === 0) return Promise.resolve([]);
  return query<SearchHit>(
    `select distinct on (c.id)
            c.id, c.standard_id, s.title as standard_title, s.status as standard_status, s.publisher,
            c.clause_path, c.heading_trail, c.page, c.pdf_file_page, c.obligation_type, c.normativity,
            c.verbatim_text, c.defined_terms, c.uri, s.source_url,
            0::float8 as score, null::int as dense_rnk, null::int as qdense_rnk, null::int as lex_rnk,
            0::float8 as dense_sim, null::float8 as q_sim, 0::float8 as lex_score,
            e.edge_type as matched_question
     from clause_edges e
     join clauses c on c.id = e.dst_clause
     join standards s on s.id = c.standard_id
     where e.src_clause = any($1) and c.id <> all($1) and ${PUBLISHED}
     order by c.id, array_position(array['reference','supersedes','defines_term','similar'], e.edge_type), e.weight desc
     limit $2`,
    [seedIds, limit],
  );
}

export type ClauseFigure = {
  id: number;
  clause_id: number;
  kind: string;
  image_url: string | null;
  transcription: string;
  page: number;
  pdf_file_page: number;
};

// Tables/figures attached to a clause (rendered image + vision transcription).
export function getClauseFigures(clauseId: number): Promise<ClauseFigure[]> {
  return query<ClauseFigure>(
    `select id, clause_id, kind, image_url, transcription, page, pdf_file_page
     from clause_figures where clause_id = $1 order by id`,
    [clauseId],
  );
}

export type FigureHit = ClauseFigure & {
  standard_id: string;
  standard_title: string;
  clause_path: string | null;
  sim: number;
};

// Semantic search over figure/table transcriptions (for Ask: makes diagram/
// matrix content directly answerable). Hidden standards excluded.
export function figureSearch(embedding: number[], limit = 4): Promise<FigureHit[]> {
  const vec = `[${embedding.join(",")}]`;
  return query<FigureHit>(
    `select f.id, f.clause_id, f.kind, f.image_url, f.transcription, f.page, f.pdf_file_page,
            f.standard_id, s.title as standard_title, c.clause_path,
            (1 - (f.embedding <=> $1::vector))::float8 as sim
     from clause_figures f
     join standards s on s.id = f.standard_id
     left join clauses c on c.id = f.clause_id
     where f.embedding is not null and ${PUBLISHED}
     order by f.embedding <=> $1::vector limit $2`,
    [vec, limit],
  );
}

// APPLIES_TO: which stadium categories the compliance matrices cover, per standard.
export type ApplicabilitySummary = {
  standard_id: string;
  standard_title: string;
  category: string;
  mandatory: number;
  best_practice: number;
};
export function getApplicabilitySummary(): Promise<ApplicabilitySummary[]> {
  return query<ApplicabilitySummary>(
    `select a.standard_id, s.title as standard_title, a.category,
            count(*) filter (where a.modality = 'mandatory')::int as mandatory,
            count(*) filter (where a.modality = 'best_practice')::int as best_practice
     from clause_applicability a
     join standards s on s.id = a.standard_id
     where ${PUBLISHED}
     group by a.standard_id, s.title, a.category
     order by s.title, a.category`,
    [],
  );
}

export type CategoryRequirement = {
  id: number;
  req_ref: string | null;
  requirement: string;
  value: string | null;
  modality: string; // mandatory | best_practice
  clause_id: number | null;
  clause_path: string | null;
};

// Applicability rows for a category across all published standards that have matrices,
// for injecting into Ask when a question names a category. Carries clause_id so answers
// can cite. Excludes non-applicable cells.
export type ApplicabilityContext = {
  clause_id: number | null;
  clause_path: string | null;
  standard_title: string;
  req_ref: string | null;
  requirement: string;
  value: string | null;
  modality: string;
};
export function getCategoryApplicability(category: string, limit = 90): Promise<ApplicabilityContext[]> {
  return query<ApplicabilityContext>(
    `select a.clause_id, c.clause_path, s.title as standard_title, a.req_ref, a.requirement, a.value, a.modality
     from clause_applicability a
     join standards s on s.id = a.standard_id
     left join clauses c on c.id = a.clause_id
     where a.category = $1 and a.modality <> 'non_applicable' and ${PUBLISHED}
     order by array_position(array['mandatory','best_practice'], a.modality), a.req_ref nulls last, a.id
     limit $2`,
    [category, limit],
  );
}

// Resolve clauses by id into SearchHit shape (score 0; context, not ranked hits) so
// citations from injected applicability rows resolve in the Ask response.
export function getClausesByIds(ids: number[]): Promise<SearchHit[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return query<SearchHit>(
    `select c.id, c.standard_id, s.title as standard_title, s.status as standard_status, s.publisher,
            c.clause_path, c.heading_trail, c.page, c.pdf_file_page, c.obligation_type, c.normativity,
            c.verbatim_text, c.defined_terms, c.uri, s.source_url,
            0::float8 as score, null::int as dense_rnk, null::int as qdense_rnk, null::int as lex_rnk,
            0::float8 as dense_sim, null::float8 as q_sim, 0::float8 as lex_score, null::text as matched_question
     from clauses c join standards s on s.id = c.standard_id
     where c.id = any($1) and ${PUBLISHED}`,
    [ids],
  );
}

// Every requirement that applies to a stadium category for a standard (the answer to
// "what must a Category B stadium comply with?"). Non-applicable cells are excluded.
export function getCategoryRequirements(standardId: string, category: string): Promise<CategoryRequirement[]> {
  return query<CategoryRequirement>(
    `select a.id, a.req_ref, a.requirement, a.value, a.modality, a.clause_id, c.clause_path
     from clause_applicability a
     left join clauses c on c.id = a.clause_id
     where a.standard_id = $1 and a.category = $2 and a.modality <> 'non_applicable'
     order by array_position(array['mandatory','best_practice'], a.modality), a.req_ref nulls last, a.id`,
    [standardId, category],
  );
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

export type StandardClauseRow = {
  id: number;
  clause_path: string;
  heading_trail: string | null;
  page: number;
  obligation_type: string;
  normativity: string;
  text: string;
};

// Lightweight clause list for a standard's browse page (each row links to the
// clause page). Ordered as they appear in the document.
export function listStandardClauses(standardId: string): Promise<StandardClauseRow[]> {
  return query<StandardClauseRow>(
    `select c.id, c.clause_path, c.heading_trail, c.page, c.obligation_type, c.normativity,
            left(c.verbatim_text, 200) as text
     from clauses c
     join standards s on s.id = c.standard_id
     where c.standard_id = $1 and ${PUBLISHED}
     order by c.pdf_file_page, c.id`,
    [standardId],
  );
}

export type AllClauseRow = {
  id: number;
  clause_path: string;
  standard_id: string;
  standard_title: string;
  standard_status: string | null;
  obligation_type: string;
  page: number;
  text: string;
};

// Every clause across every published standard, for the global /clauses browse page.
export function listAllClauses(): Promise<AllClauseRow[]> {
  return query<AllClauseRow>(
    `select c.id, c.clause_path, c.standard_id, s.title as standard_title, s.status as standard_status,
            c.obligation_type, c.page, left(c.verbatim_text, 160) as text
     from clauses c join standards s on s.id = c.standard_id
     where ${PUBLISHED}
     order by s.status = 'Superseded', s.title, c.pdf_file_page, c.id`,
    [],
  );
}

export type ClauseFindRow = {
  id: number;
  clause_path: string;
  standard_id: string;
  standard_title: string;
  obligation_type: string;
  text: string;
};

// Fast clause lookup for the header jump box: substring match on number/heading/
// text, ranked so clause-number prefix matches come first. Cheap ILIKE, no embeddings.
export function findClauses(q: string, limit = 8): Promise<ClauseFindRow[]> {
  return query<ClauseFindRow>(
    `select c.id, c.clause_path, c.standard_id, s.title as standard_title, c.obligation_type,
            left(c.verbatim_text, 90) as text
     from clauses c join standards s on s.id = c.standard_id
     where ${PUBLISHED} and (c.clause_path ilike $1 or c.heading_trail ilike $1 or c.verbatim_text ilike $1)
     order by (c.clause_path ilike $2) desc, length(c.clause_path), c.clause_path, s.title
     limit $3`,
    [`%${q}%`, `${q}%`, limit],
  );
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
