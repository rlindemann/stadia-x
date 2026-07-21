"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AllClauseRow, StandardRow } from "@/lib/db";

const OB_CLASS: Record<string, string> = {
  requirement: "shall", recommendation: "should", permission: "may", informative: "info",
};

// Raw block_type -> browsable group. Definitions carry the ◆ marker instead of a tag.
const GROUP_OF: Record<string, string> = {
  paragraph: "paragraph", heading: "heading", section: "heading",
  table: "table", definition: "definition", list_item: "list", list: "list",
};
const KINDS = [
  { key: "", label: "All types" },
  { key: "paragraph", label: "Paragraphs" },
  { key: "heading", label: "Headings" },
  { key: "table", label: "Tables" },
  { key: "definition", label: "Definitions" },
  { key: "list", label: "Lists" },
];
// Short tag shown on the row (paragraph is the norm, definition uses ◆ — neither gets a tag).
const TYPE_TAG: Record<string, string> = {
  heading: "heading", section: "section", table: "table", list_item: "list", list: "list",
};

export function StandardsLibrary({
  standards,
  clauses,
  initialDoc = "",
}: {
  standards: StandardRow[];
  clauses: AllClauseRow[];
  initialDoc?: string;
}) {
  const [sel, setSel] = useState<string[]>(initialDoc ? [initialDoc] : []);
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<StandardRow | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pickRef = useRef<HTMLDivElement>(null);

  // Close the picker on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggleDoc = (id: string) =>
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selDocs = standards.filter((s) => sel.includes(s.id));
  const totalClauses = clauses.length;

  // Clauses in the selected documents (empty selection = all) — drives the type-chip counts.
  const docFiltered = useMemo(
    () => clauses.filter((c) => sel.length === 0 || sel.includes(c.standard_id)),
    [clauses, sel],
  );
  const kindCounts = useMemo(() => {
    const m: Record<string, number> = { "": docFiltered.length };
    for (const c of docFiltered) {
      const g = GROUP_OF[c.block_type ?? ""] ?? "paragraph";
      m[g] = (m[g] ?? 0) + 1;
    }
    return m;
  }, [docFiltered]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return docFiltered.filter((c) => {
      if (kind && (GROUP_OF[c.block_type ?? ""] ?? "paragraph") !== kind) return false;
      if (!t) return true;
      return (
        c.clause_path.toLowerCase().includes(t) ||
        c.standard_title.toLowerCase().includes(t) ||
        c.text.toLowerCase().includes(t)
      );
    });
  }, [q, kind, docFiltered]);

  const headTitle =
    sel.length === 0 ? "All clauses" : sel.length === 1 ? selDocs[0]?.title : `${sel.length} documents`;
  const headSub =
    sel.length === 1
      ? [selDocs[0]?.publisher, selDocs[0]?.version].filter(Boolean).join(" · ") +
        (selDocs[0]?.status === "Superseded" && selDocs[0]?.superseded_by_title
          ? ` · superseded by ${selDocs[0].superseded_by_title}`
          : "")
      : sel.length === 0
        ? "Every clause across all documents, in reading order."
        : `Combined clauses from ${sel.length} selected documents.`;

  return (
    <div className="lib">
      {/* Left rail — pick one or more documents */}
      <aside className="lib-docs">
        <div className="lib-picker" ref={pickRef}>
          <button
            type="button"
            className="lib-picker-btn"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span>{sel.length === 0 ? "All documents" : `${sel.length} selected`}</span>
            <span className="lib-caret" aria-hidden />
          </button>
          {open && (
            <div className="lib-picker-menu" role="listbox">
              {standards.map((s) => (
                <label
                  className="lib-pick"
                  key={s.id}
                  onMouseEnter={() => s.thumb_url && setHover(s)}
                  onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                >
                  <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggleDoc(s.id)} />
                  <span className="lib-pick-title">
                    {s.title}
                    {s.status === "Superseded" ? <span className="lib-pick-sup"> superseded</span> : null}
                  </span>
                  <span className="lib-pick-n">{s.clause_count}</span>
                </label>
              ))}
              {sel.length > 0 && (
                <button type="button" className="lib-clear" onClick={() => setSel([])}>
                  Clear selection
                </button>
              )}
            </div>
          )}
        </div>

        {/* Selected documents, each removable; the "all" card stands in when none are picked. */}
        {sel.length === 0 ? (
          <div className="lib-doc lib-all on">
            <span className="lib-doc-title">All documents</span>
            <span className="lib-doc-count">{totalClauses}</span>
            <span className="lib-doc-meta">{standards.length} documents · every clause</span>
          </div>
        ) : (
          selDocs.map((s) => (
            <div className="lib-doc on" key={s.id}>
              <span className="lib-doc-title">{s.title}</span>
              <button
                type="button"
                className="lib-doc-x"
                aria-label={`Remove ${s.title}`}
                onClick={() => toggleDoc(s.id)}
              >
                ×
              </button>
              <span className="lib-doc-meta">
                {[s.publisher, s.version].filter(Boolean).join(" · ") || "—"} · {s.clause_count} clauses
              </span>
              <span className="lib-doc-tags">
                <span className={`status ${s.status === "Superseded" ? "superseded" : ""}`}>
                  <span className="sw" />
                  {s.status ?? "—"}
                </span>
                {s.superseded_by_title && <span className="lib-repl">→ {s.superseded_by_title}</span>}
              </span>
            </div>
          ))
        )}
      </aside>

      {/* Right pane — the clauses */}
      <section className="lib-clauses">
        <div className="lib-head">
          <div>
            <h2 className="lib-head-title">{headTitle}</h2>
            <p className="lib-head-sub">{headSub}</p>
          </div>
          {sel.length === 1 && selDocs[0] && (
            <Link className="lib-review" href={`/review?doc=${encodeURIComponent(selDocs[0].id)}`}>
              Open in Review viewer
            </Link>
          )}
        </div>

        <div className="sc-filter">
          <input
            className="sc-input"
            placeholder="Filter by clause number, document, or text…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="sc-shown">{shown.length} of {docFiltered.length}</span>
        </div>

        <div className="lib-kinds">
          {KINDS.map((k) => {
            const n = kindCounts[k.key] ?? 0;
            if (k.key && n === 0) return null;
            return (
              <button
                type="button"
                key={k.key || "all"}
                className={`lib-kind${kind === k.key ? " on" : ""}`}
                onClick={() => setKind(k.key)}
              >
                {k.label} <span className="lib-kind-n">{n}</span>
              </button>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <p className="c-muted">No clauses match your filter.</p>
        ) : (
          <ul className="sc-items">
            {shown.map((c) => (
              <li key={c.id}>
                <Link href={`/clause/${c.id}`} className="sc-item">
                  <span className="sc-path">{c.clause_path.replace(/^DEF-/, "◆ ")}</span>
                  {TYPE_TAG[c.block_type ?? ""] && (
                    <span className="sc-type">{TYPE_TAG[c.block_type ?? ""]}</span>
                  )}
                  <span className={`ob ${OB_CLASS[c.obligation_type] ?? "info"}`}>
                    <span className="sw" />
                    {c.obligation_type}
                  </span>
                  {sel.length !== 1 && (
                    <span className="sc-std">
                      {c.standard_title}{c.standard_status === "Superseded" ? " · superseded" : ""}
                    </span>
                  )}
                  <span className="sc-text">{c.text}</span>
                  <span className="sc-page">p.{c.page}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hover?.thumb_url && (
        <img
          className="thumb-pop"
          src={hover.thumb_url}
          alt={`${hover.title} title page`}
          style={{
            left: Math.min(pos.x + 20, (typeof window !== "undefined" ? window.innerWidth : 1200) - 260),
            top: Math.min(pos.y + 16, (typeof window !== "undefined" ? window.innerHeight : 800) - 340),
          }}
        />
      )}
    </div>
  );
}
