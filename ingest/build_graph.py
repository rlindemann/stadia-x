"""
Build the clause knowledge-graph edges for GraphRAG traversal.

Populates `clause_edges` (src -> dst, typed) so the app can do multi-hop
retrieval with recursive CTEs on Postgres — no triplestore. Idempotent:
clears and rebuilds every edge. Run after ingest/load.py.

    uv run python -m ingest.build_graph

Edge types:
  reference    resolved "see clause X" citation (also backfills refs.to_clause)
  supersedes   same clause number across a superseding edition
  defines_term a clause -> the clause that defines a term it uses
  similar      semantic k-NN over clause embeddings (dense; always hoppable)
"""

from __future__ import annotations

import os
import re

import psycopg
from dotenv import load_dotenv

load_dotenv()

SIMILAR_K = 6          # nearest neighbours per clause
SIMILAR_MIN = 0.55     # drop weak semantic edges
TERM_MIN_LEN = 5       # ignore very short terms (false ILIKE hits)

CLAUSE_NUM = re.compile(r"^(?:article|clause|section|art\.?)?\s*(\d+(?:\.\d+)*)\.?$", re.I)

SCHEMA = """
create table if not exists clause_edges (
  src_clause bigint not null references clauses(id) on delete cascade,
  dst_clause bigint not null references clauses(id) on delete cascade,
  edge_type  text   not null,
  weight     real   not null default 1,
  meta       jsonb  not null default '{}',
  primary key (src_clause, dst_clause, edge_type)
);
create index if not exists clause_edges_src_idx on clause_edges(src_clause);
create index if not exists clause_edges_dst_idx on clause_edges(dst_clause);
"""


def resolve_references(cur) -> int:
    """Parse refs.raw -> clause in the same standard; backfill refs.to_clause and
    emit 'reference' edges."""
    cur.execute("select standard_id, clause_path, id from clauses")
    by_std: dict[str, dict[str, int]] = {}
    for sid, cp, cid in cur.fetchall():
        by_std.setdefault(sid, {})[cp.strip().rstrip(".")] = cid

    cur.execute(
        """select r.id, r.raw, r.from_clause, c.standard_id
           from refs r join clauses c on c.id = r.from_clause
           where r.raw is not null"""
    )
    edges = 0
    for ref_id, raw, from_clause, sid in cur.fetchall():
        m = CLAUSE_NUM.match(raw.strip())
        if not m:
            continue
        target = by_std.get(sid, {}).get(m.group(1))
        if not target or target == from_clause:
            continue
        cur.execute("update refs set to_clause = %s, reference_type = 'internal' where id = %s",
                    (target, ref_id))
        cur.execute(
            """insert into clause_edges (src_clause, dst_clause, edge_type)
               values (%s, %s, 'reference') on conflict do nothing""",
            (from_clause, target),
        )
        edges += cur.rowcount
    return edges


def main() -> None:
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute(SCHEMA)
        cur.execute("truncate clause_edges")

        ref_edges = resolve_references(cur)
        print(f"reference edges: {ref_edges}")

        # supersedes: match clause_path across a superseding edition (new -> old and old -> new)
        cur.execute(
            """insert into clause_edges (src_clause, dst_clause, edge_type)
               select cn.id, co.id, 'supersedes'
               from standards s
               join clauses cn on cn.standard_id = s.id
               join clauses co on co.standard_id = s.supersedes and co.clause_path = cn.clause_path
               where s.supersedes is not null
               on conflict do nothing"""
        )
        sup = cur.rowcount
        cur.execute(
            """insert into clause_edges (src_clause, dst_clause, edge_type)
               select co.id, cn.id, 'supersedes'
               from standards s
               join clauses cn on cn.standard_id = s.id
               join clauses co on co.standard_id = s.supersedes and co.clause_path = cn.clause_path
               where s.supersedes is not null
               on conflict do nothing"""
        )
        print(f"supersedes edges: {sup + cur.rowcount}")

        # defines_term: a clause that mentions a term -> the clause defining that term
        cur.execute(
            """insert into clause_edges (src_clause, dst_clause, edge_type)
               select distinct c.id, t.defined_in_clause, 'defines_term'
               from terms t
               join clauses c on c.id <> t.defined_in_clause
                 and c.verbatim_text ilike '%%' || t.term || '%%'
               where t.defined_in_clause is not null and length(t.term) >= %s
               on conflict do nothing""",
            (TERM_MIN_LEN,),
        )
        print(f"defines_term edges: {cur.rowcount}")

        # similar: semantic k-NN over embeddings (HNSW-backed)
        cur.execute(
            """insert into clause_edges (src_clause, dst_clause, edge_type, weight)
               select c1.id, nn.id, 'similar', (1 - nn.dist)::real
               from clauses c1
               cross join lateral (
                 select c2.id, (c1.embedding <=> c2.embedding) as dist
                 from clauses c2 where c2.id <> c1.id
                 order by c1.embedding <=> c2.embedding limit %s
               ) nn
               where (1 - nn.dist) >= %s
               on conflict (src_clause, dst_clause, edge_type) do nothing""",
            (SIMILAR_K, SIMILAR_MIN),
        )
        print(f"similar edges: {cur.rowcount}")

        conn.commit()

        cur.execute("select edge_type, count(*) from clause_edges group by edge_type order by 2 desc")
        print("--- totals ---")
        for et, n in cur.fetchall():
            print(f"  {et}: {n}")
        cur.execute("select count(*) from clause_edges")
        print(f"  TOTAL: {cur.fetchone()[0]}")


if __name__ == "__main__":
    main()
