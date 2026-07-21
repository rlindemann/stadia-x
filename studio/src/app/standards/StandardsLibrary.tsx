"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  const [doc, setDoc] = useState(initialDoc);
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<StandardRow | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const totalClauses = clauses.length;
  const selected = standards.find((s) => s.id === doc) ?? null;

  // Clauses in the selected document (before type/text filters) — drives the type-chip counts.
  const docFiltered = useMemo(
    () => clauses.filter((c) => !doc || c.standard_id === doc),
    [clauses, doc],
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

  return (
    <div className="lib">
      {/* Left rail — the document catalogue */}
      <aside className="lib-docs">
        <button
          type="button"
          className={`lib-doc lib-all${doc === "" ? " on" : ""}`}
          onClick={() => setDoc("")}
        >
          <span className="lib-doc-title">All documents</span>
          <span className="lib-doc-count">{totalClauses}</span>
          <span className="lib-doc-meta">{standards.length} documents · every clause</span>
        </button>

        {standards.map((s) => (
          <button
            type="button"
            key={s.id}
            className={`lib-doc${doc === s.id ? " on" : ""}`}
            onClick={() => setDoc(s.id)}
            onMouseEnter={() => s.thumb_url && setHover(s)}
            onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover(null)}
          >
            <span className="lib-doc-title">{s.title}</span>
            <span className="lib-doc-count">{s.clause_count}</span>
            <span className="lib-doc-meta">
              {[s.publisher, s.version].filter(Boolean).join(" · ") || "—"}
            </span>
            <span className="lib-doc-tags">
              <span className={`status ${s.status === "Superseded" ? "superseded" : ""}`}>
                <span className="sw" />
                {s.status ?? "—"}
              </span>
              {s.superseded_by_title && (
                <span className="lib-repl">→ {s.superseded_by_title}</span>
              )}
            </span>
          </button>
        ))}
      </aside>

      {/* Right pane — the clauses */}
      <section className="lib-clauses">
        <div className="lib-head">
          <div>
            <h2 className="lib-head-title">
              {selected ? selected.title : "All clauses"}
            </h2>
            <p className="lib-head-sub">
              {selected ? (
                <>
                  {[selected.publisher, selected.version].filter(Boolean).join(" · ")}
                  {selected.status === "Superseded" && selected.superseded_by_title
                    ? ` · superseded by ${selected.superseded_by_title}`
                    : ""}
                </>
              ) : (
                "Every clause across all documents, in reading order."
              )}
            </p>
          </div>
          {selected && (
            <Link className="lib-review" href={`/review?doc=${encodeURIComponent(selected.id)}`}>
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
                  {!doc && (
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
