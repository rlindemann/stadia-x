"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { wordDiff } from "@/lib/word-diff";

type Pair = { current_id: string; current_title: string; previous_id: string; previous_title: string };
type Clause = {
  id: number;
  clause_path: string;
  heading_trail: string;
  obligation_type: string;
  page: number;
  pdf_file_page: number;
  verbatim_text: string;
};
type Edition = {
  current: { id: string; title: string };
  previous: { id: string; title: string };
  current_clauses: Clause[];
  previous_clauses: Clause[];
};

type Row =
  | { kind: "changed"; path: string; cur: Clause; prev: Clause }
  | { kind: "added"; path: string; cur: Clause }
  | { kind: "removed"; path: string; prev: Clause }
  | { kind: "same"; path: string; cur: Clause };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function buildRows(ed: Edition): Row[] {
  const prevByPath = new Map(ed.previous_clauses.map((c) => [c.clause_path, c]));
  const curByPath = new Map(ed.current_clauses.map((c) => [c.clause_path, c]));
  const rows: Row[] = [];

  for (const cur of ed.current_clauses) {
    const prev = prevByPath.get(cur.clause_path);
    if (!prev) rows.push({ kind: "added", path: cur.clause_path, cur });
    else if (norm(prev.verbatim_text) !== norm(cur.verbatim_text))
      rows.push({ kind: "changed", path: cur.clause_path, cur, prev });
    else rows.push({ kind: "same", path: cur.clause_path, cur });
  }
  for (const prev of ed.previous_clauses) {
    if (!curByPath.has(prev.clause_path)) rows.push({ kind: "removed", path: prev.clause_path, prev });
  }
  // Order by clause path numerically where possible.
  return rows.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export default function ComparePage() {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [pick, setPick] = useState<string>("");
  const [ed, setEd] = useState<Edition | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState<Record<string, boolean>>({ changed: true, added: true, removed: true, same: false });

  useEffect(() => {
    fetch("/api/editions")
      .then((r) => r.json())
      .then((d) => {
        const list: Pair[] = d.pairs ?? [];
        setPairs(list);
        if (list[0]) setPick(list[0].current_id);
      })
      .catch(() => setPairs([]));
  }, []);

  useEffect(() => {
    if (!pick) return;
    setLoading(true);
    setEd(null);
    fetch(`/api/editions/${encodeURIComponent(pick)}`)
      .then((r) => r.json())
      .then((d) => setEd(d.error ? null : d))
      .catch(() => setEd(null))
      .finally(() => setLoading(false));
  }, [pick]);

  const rows = useMemo(() => (ed ? buildRows(ed) : []), [ed]);
  const counts = useMemo(() => {
    const c = { changed: 0, added: 0, removed: 0, same: 0 };
    rows.forEach((r) => (c[r.kind] += 1));
    return c;
  }, [rows]);

  if (pairs === null) return <div className="stage"><div className="empty">Loading…</div></div>;
  if (pairs.length === 0)
    return (
      <div className="stage">
        <div className="page-head">
          <h1 className="page-title">Edition comparison</h1>
          <p className="page-sub">No superseded editions are loaded, so there is nothing to compare yet.</p>
        </div>
      </div>
    );

  const visible = rows.filter((r) => show[r.kind]);

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Edition comparison</h1>
        <p className="page-sub">
          What changed between two editions of the same standard, clause by clause. Clauses are matched
          by clause number; wording changes are shown inline.
        </p>
      </div>

      <div className="cmp-bar">
        <span className="sel">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Standard">
            {pairs.map((p) => (
              <option key={p.current_id} value={p.current_id}>{p.current_title}</option>
            ))}
          </select>
        </span>
        {ed && (
          <span className="cmp-vs">
            <b>{ed.previous.title}</b> → <b>{ed.current.title}</b>
          </span>
        )}
      </div>

      {loading && <div className="empty">Diffing editions…</div>}

      {ed && !loading && (
        <>
          <div className="cmp-filters">
            {(["changed", "added", "removed", "same"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`chip cmp-${k}${show[k] ? " on" : ""}`}
                onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
              >
                {k} · {counts[k]}
              </button>
            ))}
          </div>

          <div className="list">
            {visible.map((r) => (
              <article className={`cmp-row cmp-${r.kind}`} key={`${r.kind}-${r.path}`}>
                <div className="cmp-row-head">
                  <span className={`cmp-tag cmp-${r.kind}`}>{r.kind}</span>
                  <span className="path">{r.path}</span>
                  {"cur" in r && r.cur.heading_trail && <span className="ct">{r.cur.heading_trail}</span>}
                  {r.kind === "removed" && r.prev.heading_trail && <span className="ct">{r.prev.heading_trail}</span>}
                </div>

                {r.kind === "changed" ? (
                  <p className="quote cmp-diff">
                    {wordDiff(r.prev.verbatim_text, r.cur.verbatim_text).map((seg, i) => (
                      <Fragment key={i}>
                        {seg.type === "same" && <span>{seg.text}</span>}
                        {seg.type === "add" && <ins>{seg.text}</ins>}
                        {seg.type === "del" && <del>{seg.text}</del>}
                      </Fragment>
                    ))}
                  </p>
                ) : (
                  <p className="quote">{("cur" in r ? r.cur : r.prev).verbatim_text}</p>
                )}

                <div className="src">
                  {"cur" in r && <Link href={`/clause/${r.cur.id}`}>Current p.{r.cur.page}</Link>}
                  {r.kind === "changed" && <Link href={`/clause/${r.prev.id}`}>Previous p.{r.prev.page}</Link>}
                  {r.kind === "removed" && <Link href={`/clause/${r.prev.id}`}>Previous p.{r.prev.page}</Link>}
                </div>
              </article>
            ))}
            {visible.length === 0 && <div className="empty">No clauses match the selected filters.</div>}
          </div>
        </>
      )}
    </div>
  );
}
