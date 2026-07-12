"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const PdfPane = dynamic(() => import("./PdfPane"), {
  ssr: false,
  loading: () => <div className="rv-pdf-msg">Loading PDF…</div>,
});

type Clause = {
  id: number;
  clause_path: string;
  heading_trail: string;
  page: number;
  pdf_file_page: number;
  block_type: string;
  verbatim_text: string;
  obligation_type: string;
  normativity: string;
  references: string[];
  defined_terms: string[];
  anticipated_questions: string[];
  uri: string | null;
};

type Doc = { id: string; title: string; source_url: string | null; clause_count: number };

const OBLIG_CLASS: Record<string, string> = {
  requirement: "ob-shall",
  recommendation: "ob-should",
  permission: "ob-may",
  informative: "ob-info",
};

export default function ReviewPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) => {
        const list: Doc[] = d.documents ?? [];
        setDocs(list);
        if (list[0]) setDocId(list[0].id);
      })
      .catch(() => setDocs([]));
  }, []);

  const doc = useMemo(() => docs?.find((d) => d.id === docId) ?? null, [docs, docId]);

  useEffect(() => {
    if (!docId) return;
    setClauses([]);
    setActiveIdx(null);
    setPageNumber(1);
    fetch(`/api/documents/${encodeURIComponent(docId)}/clauses`)
      .then((r) => r.json())
      .then((d) => setClauses(d.clauses ?? []))
      .catch(() => setClauses([]));
  }, [docId]);

  const select = (i: number, c: Clause) => {
    setActiveIdx(i);
    setPageNumber(c.pdf_file_page + 1); // 1-based; PdfPane re-renders the page, no reload
  };

  if (docs === null) return <div className="rv-empty">Loading…</div>;

  if (docs.length === 0)
    return (
      <div className="rv-empty">
        <p>No documents loaded.</p>
        <p className="rv-empty-sub">
          Run <code>uv run python -m ingest.load … --pdf …</code> to load a document for review.
        </p>
      </div>
    );

  return (
    <div className="rv">
      <div className="rv-bar">
        <select className="rv-select" value={docId ?? ""} onChange={(e) => setDocId(e.target.value)}>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} — {d.clause_count} clauses
            </option>
          ))}
        </select>
        <span className="rv-count">{clauses.length} extracted blocks</span>
      </div>

      <div className="rv-split">
        <div className="rv-list">
          {clauses.map((c, i) => (
            <div
              key={c.id}
              className={`rv-item${i === activeIdx ? " on" : ""}`}
              onClick={() => select(i, c)}
            >
              <div className="rv-item-head">
                <span className="rv-path">{c.clause_path}</span>
                <span className={`rv-ob ${OBLIG_CLASS[c.obligation_type] ?? "ob-info"}`}>
                  {c.obligation_type}
                </span>
                <span className="rv-norm">{c.normativity}</span>
                <span className="rv-type">{c.block_type}</span>
                <span className="rv-pg">
                  p.{c.page} · pdf {c.pdf_file_page}
                </span>
              </div>
              {c.heading_trail && <div className="rv-trail">{c.heading_trail}</div>}
              <p className="rv-verbatim">{c.verbatim_text}</p>

              <dl className="rv-fields">
                <dt>Defined terms</dt>
                <dd>{c.defined_terms.length ? c.defined_terms.join(", ") : "—"}</dd>
                <dt>References</dt>
                <dd>{c.references.length ? c.references.join(", ") : "—"}</dd>
                <dt>Anticipated questions</dt>
                <dd>
                  {c.anticipated_questions.length ? (
                    <ul className="rv-q">
                      {c.anticipated_questions.map((q, j) => (
                        <li key={j}>{q}</li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt>URI</dt>
                <dd className="rv-uri">{c.uri ?? "—"}</dd>
              </dl>

              <details className="rv-raw" onClick={(e) => e.stopPropagation()}>
                <summary>Raw JSON</summary>
                <pre>{JSON.stringify(c, null, 2)}</pre>
              </details>
            </div>
          ))}
        </div>

        {doc?.source_url ? (
          <PdfPane
            fileUrl={`/api/documents/${encodeURIComponent(doc.id)}/pdf`}
            pageNumber={pageNumber}
            onPageChange={setPageNumber}
          />
        ) : (
          <div className="rv-pdf">
            <div className="rv-pdf-msg">No source PDF on file for this document.</div>
          </div>
        )}
      </div>
    </div>
  );
}
