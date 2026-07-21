"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AllClauseRow } from "@/lib/db";

const OB_CLASS: Record<string, string> = {
  requirement: "shall", recommendation: "should", permission: "may", informative: "info",
};

export function AllClauseList({ clauses }: { clauses: AllClauseRow[] }) {
  const [q, setQ] = useState("");
  const [std, setStd] = useState("");

  // Distinct standards in display order (superseded already sorted last upstream).
  const standards = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of clauses) if (!seen.has(c.standard_id)) seen.set(c.standard_id, c.standard_title);
    return [...seen].map(([id, title]) => ({ id, title }));
  }, [clauses]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return clauses.filter((c) => {
      if (std && c.standard_id !== std) return false;
      if (!t) return true;
      return (
        c.clause_path.toLowerCase().includes(t) ||
        c.standard_title.toLowerCase().includes(t) ||
        c.text.toLowerCase().includes(t)
      );
    });
  }, [q, std, clauses]);

  return (
    <div className="sc-list">
      <div className="sc-filter">
        <input
          className="sc-input"
          placeholder="Filter by clause number, standard, or text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="sel sc-sel">
          <select value={std} onChange={(e) => setStd(e.target.value)} aria-label="Filter by standard">
            <option value="">All standards</option>
            {standards.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
        <span className="sc-shown">{shown.length} of {clauses.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="c-muted">No clauses match &ldquo;{q}&rdquo;.</p>
      ) : (
        <ul className="sc-items">
          {shown.map((c) => (
            <li key={c.id}>
              <Link href={`/clause/${c.id}`} className="sc-item">
                <span className="sc-path">{c.clause_path.replace(/^DEF-/, "◆ ")}</span>
                <span className={`ob ${OB_CLASS[c.obligation_type] ?? "info"}`}>
                  <span className="sw" />
                  {c.obligation_type}
                </span>
                <span className="sc-std">
                  {c.standard_title}{c.standard_status === "Superseded" ? " · superseded" : ""}
                </span>
                <span className="sc-text">{c.text}</span>
                <span className="sc-page">p.{c.page}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
