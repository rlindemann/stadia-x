"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Clause = {
  standard_id: string;
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

type Doc = { id: string; title: string; pdf: string; data: string; count: number };

const OBLIG_CLASS: Record<string, string> = {
  requirement: "ob-shall",
  recommendation: "ob-should",
  permission: "ob-may",
  informative: "ob-info",
};

export default function ReviewPage() {
  const [manifest, setManifest] = useState<Doc[] | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch("/extractions/manifest.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((m: Doc[]) => {
        setManifest(m);
        if (m[0]) setDocId(m[0].id);
      })
      .catch(() => setManifest([]));
  }, []);

  const doc = useMemo(() => manifest?.find((d) => d.id === docId) ?? null, [manifest, docId]);

  useEffect(() => {
    if (!doc) return;
    setClauses([]);
    setActiveIdx(null);
    fetch(`/extractions/${doc.data}`)
      .then((r) => r.json())
      .then(setClauses)
      .catch(() => setClauses([]));
  }, [doc]);

  // Jump the already-loaded PDF to a page via its hash — no iframe reload.
  const select = (i: number, c: Clause) => {
    setActiveIdx(i);
    const win = iframeRef.current?.contentWindow;
    if (win) win.location.hash = `#page=${c.pdf_file_page + 1}&view=FitH`;
  };

  if (manifest === null) return <div className="rv-empty">Loading…</div>;

  if (manifest.length === 0)
    return (
      <div className="rv-empty">
        <p>No extractions found.</p>
        <p className="rv-empty-sub">
          Run <code>uv run python -m ingest.extract &lt;pdf&gt; &lt;STANDARD_ID&gt;</code> to publish a
          document here for review.
        </p>
      </div>
    );

  return (
    <div className="rv">
      <div className="rv-bar">
        <select className="rv-select" value={docId ?? ""} onChange={(e) => setDocId(e.target.value)}>
          {manifest.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} — {d.count} clauses
            </option>
          ))}
        </select>
        <span className="rv-count">{clauses.length} extracted blocks</span>
      </div>

      <div className="rv-split">
        <div className="rv-list">
          {clauses.map((c, i) => (
            <div
              key={`${c.clause_path}-${i}`}
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

        <div className="rv-pdf">
          {doc && (
            <iframe
              ref={iframeRef}
              key={doc.pdf}
              title="source pdf"
              src={`/extractions/${doc.pdf}#page=1&view=FitH`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
