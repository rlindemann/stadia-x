import Link from "next/link";
import { notFound } from "next/navigation";
import { getClauseDetail, getClauseFigures, getClauseGraphData, type GraphViewNode } from "@/lib/db";
import { SaveButton } from "@/components/save-button";
import { CopyLink } from "@/components/copy-link";
import { ClauseGraph } from "@/components/clause-graph";

export const dynamic = "force-dynamic";

const OB_CLASS: Record<string, string> = {
  requirement: "shall",
  recommendation: "should",
  permission: "may",
  informative: "info",
};

const EDGE_GROUPS: { type: string; label: string }[] = [
  { type: "reference", label: "References" },
  { type: "defines_term", label: "Defines terms used here" },
  { type: "supersedes", label: "Same clause in another edition" },
  { type: "similar", label: "Related in meaning" },
];

export default async function ClausePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clause = await getClauseDetail(Number(id));
  if (!clause) notFound();

  const { nodes: graphNodes } = await getClauseGraphData(clause.id, 2);
  const figures = await getClauseFigures(clause.id);
  const oneHop = graphNodes.filter((n) => n.depth === 1);
  const byType = new Map<string, GraphViewNode[]>();
  for (const g of oneHop) {
    const key = g.via ?? "similar";
    const arr = byType.get(key) ?? [];
    arr.push(g);
    byType.set(key, arr);
  }

  const termLink = new Map(clause.term_defs.map((t) => [t.term, t.defined_in_clause]));

  return (
    <div className="stage">
      <div className="cd-crumbs">
        <Link href="/">Search</Link>
        <span className="sep">/</span>
        <Link href={`/review?doc=${encodeURIComponent(clause.standard_id)}`}>{clause.standard_title}</Link>
        {clause.standard_status === "Superseded" && <span className="tag-super">Superseded</span>}
      </div>

      <div className="cd-head">
        <div className="prov">
          {clause.publisher && (
            <>
              <span className="pub">{clause.publisher}</span>
              <span className="sep">/</span>
            </>
          )}
          <span>{clause.standard_title}</span>
        </div>
        <h1 className="cd-title">
          <span className="path">{clause.clause_path}</span>
          <span className={`ob ${OB_CLASS[clause.obligation_type] ?? "info"}`}>
            <span className="sw" />
            {clause.obligation_type}
          </span>
        </h1>
        {clause.heading_trail && <p className="cd-trail">{clause.heading_trail}</p>}
      </div>

      <p className="quote cd-quote">{clause.verbatim_text}</p>

      <div className="src cd-src">
        {clause.source_url ? (
          <a href={`${clause.source_url}#page=${clause.pdf_file_page + 1}`} target="_blank" rel="noreferrer">
            Open source PDF — p.{clause.page}
          </a>
        ) : (
          <span>p.{clause.page}</span>
        )}
        <Link href={`/review?doc=${encodeURIComponent(clause.standard_id)}`}>Open in Review</Link>
        <CopyLink />
        <SaveButton
          clause={{
            id: clause.id,
            clause_path: clause.clause_path,
            heading_trail: clause.heading_trail,
            standard_id: clause.standard_id,
            standard_title: clause.standard_title,
            standard_status: clause.standard_status,
            publisher: clause.publisher,
            obligation_type: clause.obligation_type,
            page: clause.page,
            pdf_file_page: clause.pdf_file_page,
            source_url: clause.source_url,
            verbatim_text: clause.verbatim_text,
          }}
        />
      </div>

      {clause.questions.length > 0 && (
        <div className="cd-answers">
          <div className="cd-answers-lbl">Questions this clause answers</div>
          <div className="cd-answers-list">
            {clause.questions.map((q, i) => (
              <Link key={i} href={`/?q=${encodeURIComponent(q)}`} className="cd-answers-chip">
                <span className="cd-answers-q">{q}</span>
                <span className="cd-answers-go" aria-hidden>search &rarr;</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {figures.length > 0 && (
        <div className="cd-figs">
          <div className="cd-figs-lbl">
            Tables &amp; figures in this clause — extracted and transcribed
          </div>
          {figures.map((f) => (
            <figure className="cd-fig" key={f.id}>
              {f.image_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={f.image_url} alt={`${f.kind} on page ${f.page}`} loading="lazy" />
              )}
              <details>
                <summary>Transcription ({f.kind}, p.{f.page})</summary>
                <pre className="cd-fig-text">{f.transcription}</pre>
              </details>
            </figure>
          ))}
        </div>
      )}

      <dl className="cd-fields">
        <dt>Normativity</dt>
        <dd>{clause.normativity || "—"}</dd>
        <dt>Block type</dt>
        <dd>{clause.block_type || "—"}</dd>

        <dt>Defined terms</dt>
        <dd>
          {clause.defined_terms.length
            ? clause.defined_terms.map((t, i) => {
                const target = termLink.get(t);
                return (
                  <span key={t}>
                    {i > 0 && ", "}
                    {target ? <Link href={`/clause/${target}`}>{t}</Link> : t}
                  </span>
                );
              })
            : "—"}
        </dd>

        <dt>References</dt>
        <dd>
          {clause.references.length ? (
            <ul className="cd-refs">
              {clause.references.map((r, i) => (
                <li key={i}>
                  {r.to_clause ? (
                    <Link href={`/clause/${r.to_clause}`}>{r.raw ?? r.to_clause_path ?? "reference"}</Link>
                  ) : r.to_standard ? (
                    <Link href={`/review?doc=${encodeURIComponent(r.to_standard)}`}>
                      {r.raw ?? r.to_standard_title ?? r.to_standard}
                    </Link>
                  ) : (
                    <span>{r.raw ?? "—"}</span>
                  )}
                  {r.reference_type && <span className="cd-reftype"> · {r.reference_type}</span>}
                </li>
              ))}
            </ul>
          ) : (
            "—"
          )}
        </dd>

        <dt>URI</dt>
        <dd className="cd-uri">{clause.uri ?? "—"}</dd>
      </dl>

      {graphNodes.length > 1 && (
        <div className="cd-graph">
          <div className="cd-graph-lbl">
            Related via graph — {oneHop.length} one hop away, {graphNodes.length - 1} within two
          </div>
          <ClauseGraph seed={clause.id} nodes={graphNodes} />
          <details className="cd-graph-list">
            <summary>List view</summary>
            {EDGE_GROUPS.filter((g) => byType.has(g.type)).map((g) => (
              <div className="cd-graph-grp" key={g.type}>
                <div className={`cd-graph-type t-${g.type}`}>{g.label}</div>
                <div className="cd-graph-items">
                  {byType.get(g.type)!.map((n) => (
                    <Link key={`${n.id}-${g.type}`} href={`/clause/${n.id}`} className="cd-graph-item">
                      <span className="path">{n.clause_path}</span>
                      {n.standard_id !== clause.standard_id && <span className="cd-graph-std">{n.standard_title}</span>}
                      <span className="cd-graph-text">{n.text.slice(0, 90)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </details>
        </div>
      )}

      <nav className="cd-neighbours">
        {clause.prev ? (
          <Link href={`/clause/${clause.prev.id}`} className="cd-nb prev">
            <span className="cd-nb-lbl">Previous</span>
            <span className="path">{clause.prev.clause_path}</span>
          </Link>
        ) : (
          <span />
        )}
        {clause.next ? (
          <Link href={`/clause/${clause.next.id}`} className="cd-nb next">
            <span className="cd-nb-lbl">Next</span>
            <span className="path">{clause.next.clause_path}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
